var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// cloudflare/worker.js
var MAX_AUDIO_BYTES = 25 * 1024 * 1024;
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers
    }
  });
}
__name(json, "json");
function serializeLecture(row) {
  return {
    _id: row.id,
    title: row.title,
    filename: row.filename,
    originalName: row.original_name,
    mimeType: row.mime_type,
    transcript: row.transcript,
    captions: JSON.parse(row.captions_json || "[]"),
    translationLanguage: row.translation_language,
    createdAt: row.created_at
  };
}
__name(serializeLecture, "serializeLecture");
function validCaption(segment) {
  return Number.isFinite(segment.start) && Number.isFinite(segment.end) && typeof segment.text === "string" && segment.text.trim();
}
__name(validCaption, "validCaption");
async function routeApi(request, env, url) {
  if (url.pathname === "/api/health" && request.method === "GET") {
    return json({ ok: true, storage: "cloudflare-d1-r2" });
  }
  if (url.pathname === "/api/lectures" && request.method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT * FROM lectures ORDER BY created_at DESC"
    ).all();
    return json(results.map(serializeLecture));
  }
  if (url.pathname === "/api/lectures" && request.method === "POST") {
    const form = await request.formData();
    const media = form.get("media");
    if (!media || typeof media.arrayBuffer !== "function" || typeof media.name !== "string") {
      return json({ message: "A lecture audio or video file is required." }, 400);
    }
    if (media.size > MAX_AUDIO_BYTES) {
      return json({ message: "Upload audio or video files up to 25 MB for English translation." }, 413);
    }
    const id = crypto.randomUUID();
    const filename = `${id}/${media.name.replace(/[\\/]/g, "_")}`;
    const title = String(form.get("title") || media.name);
    const createdAt = (/* @__PURE__ */ new Date()).toISOString();
    await env.MEDIA.put(filename, media.stream(), {
      httpMetadata: { contentType: media.type || "application/octet-stream" }
    });
    try {
      await env.DB.prepare(
        `INSERT INTO lectures
          (id, title, filename, original_name, mime_type, transcript, captions_json, translation_language, created_at)
         VALUES (?, ?, ?, ?, ?, '', '[]', NULL, ?)`
      ).bind(id, title, filename, media.name, media.type || "application/octet-stream", createdAt).run();
    } catch (error) {
      await env.MEDIA.delete(filename);
      throw error;
    }
    return json({
      _id: id,
      title,
      filename,
      originalName: media.name,
      mimeType: media.type || "application/octet-stream",
      transcript: "",
      captions: [],
      createdAt
    }, 201);
  }
  const lectureMatch = url.pathname.match(/^\/api\/lectures\/([0-9a-f-]+)(?:\/(transcribe))?$/i);
  if (lectureMatch) {
    const [, id, action] = lectureMatch;
    const row = await env.DB.prepare("SELECT * FROM lectures WHERE id = ?").bind(id).first();
    if (!row) return json({ message: "Lecture not found." }, 404);
    if (!action && request.method === "GET") {
      return json(serializeLecture(row));
    }
    if (action === "transcribe" && request.method === "POST") {
      if (!env.OPENAI_API_KEY) {
        return json({ message: "OpenAI translation is not configured on this Cloudflare deployment." }, 503);
      }
      if (env.TRANSCRIPTION_LIMITER) {
        const { success } = await env.TRANSCRIPTION_LIMITER.limit({
          key: request.headers.get("CF-Connecting-IP") || "unknown"
        });
        if (!success) {
          return json({ message: "Translation limit reached. Please wait before translating another file." }, 429);
        }
      }
      const media = await env.MEDIA.get(row.filename);
      if (!media) return json({ message: "The uploaded media file could not be found." }, 404);
      if (media.size > MAX_AUDIO_BYTES) {
        return json({ message: "OpenAI accepts audio files up to 25 MB. Upload a shorter or smaller media file." }, 413);
      }
      const form = new FormData();
      form.append("file", new Blob([await media.arrayBuffer()], {
        type: media.httpMetadata?.contentType || row.mime_type || "application/octet-stream"
      }), row.original_name);
      form.append("model", "whisper-1");
      form.append("response_format", "verbose_json");
      const upstream = await fetch("https://api.openai.com/v1/audio/translations", {
        method: "POST",
        headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` },
        body: form
      });
      if (!upstream.ok) {
        const details = await upstream.json().catch(() => ({}));
        console.error("OpenAI audio translation failed:", upstream.status, details.error?.type || "unknown error");
        return json({
          message: upstream.status === 401 ? "OpenAI rejected the configured API key." : "OpenAI could not translate this audio. Check the file format, size, and API account limits."
        }, 502);
      }
      const translation = await upstream.json();
      const captions = Array.isArray(translation.segments) ? translation.segments.filter(validCaption).map((segment) => ({
        start: segment.start,
        end: segment.end,
        text: segment.text.trim()
      })) : [];
      if (!captions.length && typeof translation.text === "string" && translation.text.trim()) {
        captions.push({
          start: 0,
          end: Number.isFinite(translation.duration) && translation.duration > 0 ? translation.duration : 0,
          text: translation.text.trim()
        });
      }
      await env.DB.prepare(
        `UPDATE lectures
         SET transcript = ?, captions_json = ?, translation_language = 'English'
         WHERE id = ?`
      ).bind(translation.text || "", JSON.stringify(captions), id).run();
      return json({
        transcript: translation.text || "",
        captions,
        translationLanguage: "English"
      });
    }
  }
  return json({ message: "API route not found." }, 404);
}
__name(routeApi, "routeApi");
async function serveUpload(request, env, url) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ message: "Method not allowed." }, 405, { allow: "GET, HEAD" });
  }
  const key = decodeURIComponent(url.pathname.slice("/uploads/".length));
  const object = await env.MEDIA.get(key, { range: request.headers });
  if (!object) return json({ message: "Media file not found." }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "private, max-age=3600");
  if (request.headers.has("range") && object.range) {
    headers.set("content-range", `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`);
    headers.set("content-length", String(object.range.length));
    return new Response(request.method === "HEAD" ? null : object.body, { status: 206, headers });
  }
  headers.set("content-length", String(object.size));
  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}
__name(serveUpload, "serveUpload");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/")) {
        return await routeApi(request, env, url);
      }
      if (url.pathname.startsWith("/uploads/")) {
        return await serveUpload(request, env, url);
      }
      return await env.ASSETS.fetch(request);
    } catch (error) {
      console.error("SignBridge request failed:", error);
      return json({ message: "SignBridge could not complete this request." }, 500);
    }
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-j8Cg5W/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-j8Cg5W/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
