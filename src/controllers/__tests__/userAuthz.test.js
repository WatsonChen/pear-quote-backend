/**
 * Tests for the P0 user-route hardening in userController.js.
 * Run with: node src/controllers/__tests__/userAuthz.test.js
 *
 * Only the rejection paths are exercised, so no database is touched: every
 * assertion here must be decided before the controller queries Prisma.
 */

import {
  getUserById,
  updateUser,
  deleteUser,
  verifyPhone,
} from "../userController.js";
import userRoutes from "../../routes/userRoutes.js";
import authRoutes from "../../routes/authRoutes.js";
import { requireInternalAuth } from "../../middleware/internalAuth.js";

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function call(handler, { params = {}, body = {}, userId = "user-a" } = {}) {
  const result = { status: null, body: null };
  const res = {
    status(code) {
      result.status = code;
      return this;
    },
    json(payload) {
      result.body = payload;
      return this;
    },
  };
  return Promise.resolve(handler({ params, body, user: { userId } }, res)).then(() => result);
}

function routeTable(router) {
  return router.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods),
      handlers: layer.route.stack.map((l) => l.handle),
    }));
}

console.log("\n[1] /api/users/:id is self-only");
{
  for (const [name, handler] of [
    ["GET", getUserById],
    ["PUT", updateUser],
    ["DELETE", deleteUser],
  ]) {
    const r = await call(handler, { params: { id: "user-b" }, body: { email: "x@y.z", password: "hunter22" } });
    assert(`${name} another user's id -> 403`, r.status === 403, `got ${r.status}`);
  }

  const noUser = await call(getUserById, { params: { id: "user-a" }, userId: null });
  assert("request without an authenticated user id -> 403", noUser.status === 403);
}

console.log("\n[2] no user listing or creation routes");
{
  const routes = routeTable(userRoutes);
  const has = (path, method) => routes.some((r) => r.path === path && r.methods.includes(method));
  assert("GET / is gone", !has("/", "get"));
  assert("POST / is gone", !has("/", "post"));
  assert("/:id routes remain", has("/:id", "get") && has("/:id", "put") && has("/:id", "delete"));
}

console.log("\n[3] verify-phone grants nothing");
{
  const r = await call(verifyPhone, { body: { phoneNumber: "0912345678" } });
  assert("responds 503", r.status === 503);
  assert("errorCode PHONE_VERIFICATION_UNAVAILABLE", r.body?.errorCode === "PHONE_VERIFICATION_UNAVAILABLE");
  assert("success is false", r.body?.success === false);
}

console.log("\n[4] social-login is behind the internal secret");
{
  const routes = routeTable(authRoutes);
  const social = routes.find((r) => r.path === "/social-login" && r.methods.includes("post"));
  assert("route exists", Boolean(social));
  assert("requireInternalAuth runs before the handler", social?.handlers[0] === requireInternalAuth);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
