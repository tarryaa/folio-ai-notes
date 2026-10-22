// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { runInNewContext } from "node:vm";

const buildScript = resolve("scripts/generate-sw.mjs");
const temporaryRoot = mkdtempSync(join(tmpdir(), "folio-pwa-"));
let source: string;
const listeners: Record<string, (event: any) => void> = {};
const assets = new Map<string, Response>();
const deleted: string[] = [];
const scope = "https://example.com/my-notes/";
let skipWaiting = 0;
let precached: string[] = [];

beforeAll(() => {
  mkdirSync(join(temporaryRoot, "dist/assets"), { recursive: true });
  mkdirSync(join(temporaryRoot, "dist/examples"), { recursive: true });
  writeFileSync(join(temporaryRoot, "dist/index.html"), "<h1>Folio</h1>");
  writeFileSync(
    join(temporaryRoot, "dist/assets/app-A1.js"),
    "/* hashed bundle */",
  );
  writeFileSync(join(temporaryRoot, "dist/assets/app-A1.js.map"), "source map");
  writeFileSync(
    join(temporaryRoot, "dist/examples/fixture.html"),
    "not app shell",
  );
  execFileSync(process.execPath, [buildScript], { cwd: temporaryRoot });
  source = readFileSync(join(temporaryRoot, "dist/sw.js"), "utf8");
  assets.set(scope + "index.html", new Response("offline shell"));
  assets.set(
    scope + "assets/app-A1.js",
    new Response("offline module", { headers: { Vary: "Origin" } }),
  );
  runInNewContext(source, {
    URL,
    Request,
    Response,
    Promise,
    Set,
    fetch: async () => {
      throw new Error("offline");
    },
    caches: {
      open: async () => ({
        addAll: async (requests: Request[]) => {
          precached = requests.map((request) => request.url);
        },
        match: async (
          request: string | Request,
          options?: CacheQueryOptions,
        ) => {
          const cached = assets.get(
            typeof request === "string" ? request : request.url,
          );
          // Precache Request has no Origin; crossorigin module requests do.
          if (
            cached?.headers.get("Vary") === "Origin" &&
            typeof request !== "string" &&
            request.headers.get("Origin") &&
            !options?.ignoreVary
          )
            return undefined;
          return cached?.clone();
        },
      }),
      keys: async () => [
        "folio-shell-" + scope + "-old-version",
        "folio-shell-https://example.com/another-app/-old-version",
        "other-application-cache",
      ],
      delete: async (key: string) => {
        deleted.push(key);
        return true;
      },
    },
    self: {
      registration: { scope },
      addEventListener: (type: string, handler: (event: any) => void) => {
        listeners[type] = handler;
      },
      skipWaiting: () => {
        skipWaiting++;
      },
      clients: { claim: async () => {} },
    },
  });
});
afterAll(() => {
  if (
    resolve(temporaryRoot).startsWith(resolve(tmpdir()) + "\\") ||
    resolve(temporaryRoot).startsWith(resolve(tmpdir()) + "/")
  ) {
    if (basename(temporaryRoot).startsWith("folio-pwa-"))
      rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

describe("generated app service worker", () => {
  it("precaches build assets under the deployment subpath, excluding examples and source maps", async () => {
    let complete: Promise<unknown> | undefined;
    listeners.install({
      waitUntil: (promise: Promise<unknown>) => {
        complete = promise;
      },
    });
    await complete;
    expect(precached).toEqual([
      scope + "assets/app-A1.js",
      scope + "index.html",
    ]);
    expect(skipWaiting).toBe(0);
  });
  it("does not delete other apps or other deployment scopes", async () => {
    let complete: Promise<unknown> | undefined;
    listeners.activate({
      waitUntil: (promise: Promise<unknown>) => {
        complete = promise;
      },
    });
    await complete;
    expect(deleted).toEqual(["folio-shell-" + scope + "-old-version"]);
  });
  it("keeps the waiting worker until a manual update message", () => {
    listeners.message({ data: { type: "OTHER" } });
    expect(skipWaiting).toBe(0);
    listeners.message({ data: { type: "SKIP_WAITING" } });
    expect(skipWaiting).toBe(1);
  });
  it("serves the matching offline shell for app navigation", async () => {
    let response: Promise<Response> | undefined;
    listeners.fetch({
      request: { method: "GET", url: scope, mode: "navigate" },
      respondWith: (promise: Promise<Response>) => {
        response = promise;
      },
    });
    expect(await (await response!).text()).toBe("offline shell");
  });
  it("serves a precached immutable module offline despite Vary: Origin", async () => {
    let response: Promise<Response> | undefined;
    const request = new Request(scope + "assets/app-A1.js", {
      headers: { Origin: new URL(scope).origin },
    });
    listeners.fetch({
      request,
      respondWith: (promise: Promise<Response>) => {
        response = promise;
      },
    });
    expect(await (await response!).text()).toBe("offline module");
  });
  it("keeps a coherent cached shell until the waiting version is explicitly activated", async () => {
    const oldVersion = source.match(/const CACHE = PREFIX \+ '([^']+)'/)![1];
    const nextSource = source.replace(oldVersion, "next-version");
    let networkCalls = 0;
    let active: Record<string, (event: any) => void>;
    function worker(script: string) {
      const events: Record<string, (event: any) => void> = {};
      let requestedActivation = false;
      runInNewContext(script, {
        URL,
        Request,
        Response,
        Promise,
        Set,
        fetch: async () => {
          networkCalls++;
          return new Response("unactivated new network HTML");
        },
        caches: {
          open: async (name: string) => ({
            addAll: async () => {},
            match: async () =>
              new Response(
                name.endsWith("next-version")
                  ? "new coherent shell"
                  : "old coherent shell",
              ),
          }),
          keys: async () => [],
          delete: async () => true,
        },
        self: {
          registration: { scope },
          addEventListener: (type: string, handler: (event: any) => void) => {
            events[type] = handler;
          },
          skipWaiting: () => {
            requestedActivation = true;
          },
          clients: {
            claim: async () => {
              active = events;
            },
          },
        },
      });
      return { events, activationRequested: () => requestedActivation };
    }
    const current = worker(source),
      waiting = worker(nextSource);
    active = current.events;
    const navigate = async () => {
      let response: Promise<Response> | undefined;
      active.fetch({
        request: { method: "GET", url: scope, mode: "navigate" },
        respondWith: (promise: Promise<Response>) => {
          response = promise;
        },
      });
      return (await response!).text();
    };
    let installed: Promise<unknown> | undefined;
    waiting.events.install({
      waitUntil: (promise: Promise<unknown>) => {
        installed = promise;
      },
    });
    await installed;
    expect(waiting.activationRequested()).toBe(false);
    expect(await navigate()).toBe("old coherent shell");
    expect(networkCalls).toBe(0);
    waiting.events.message({ data: { type: "SKIP_WAITING" } });
    expect(waiting.activationRequested()).toBe(true);
    let activated: Promise<unknown> | undefined;
    waiting.events.activate({
      waitUntil: (promise: Promise<unknown>) => {
        activated = promise;
      },
    });
    await activated;
    expect(await navigate()).toBe("new coherent shell");
    expect(networkCalls).toBe(0);
  });
  it("leaves API, authentication, remote, non-GET and other-scope requests alone", () => {
    for (const request of [
      { method: "GET", url: scope + "api/notes", mode: "cors" },
      { method: "GET", url: scope + "?access_token=secret", mode: "navigate" },
      {
        method: "GET",
        url: "https://images.example.com/image.png",
        mode: "cors",
      },
      { method: "POST", url: scope, mode: "navigate" },
      { method: "GET", url: "https://example.com/other/", mode: "navigate" },
    ]) {
      let intercepted = false;
      listeners.fetch({
        request,
        respondWith: () => {
          intercepted = true;
        },
      });
      expect(intercepted).toBe(false);
    }
  });
  it("includes file contents in the cache version", () => {
    writeFileSync(
      join(temporaryRoot, "dist/assets/app-A1.js"),
      "/* changed contents */",
    );
    execFileSync(process.execPath, [buildScript], { cwd: temporaryRoot });
    const updated = readFileSync(join(temporaryRoot, "dist/sw.js"), "utf8");
    expect(updated.match(/const CACHE = PREFIX \+ '([^']+)'/)?.[1]).not.toBe(
      source.match(/const CACHE = PREFIX \+ '([^']+)'/)?.[1],
    );
  });
});
