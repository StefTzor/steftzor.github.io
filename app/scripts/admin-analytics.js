import { profile } from "./shell.js";
import { say } from "./admin-status.js";

/**
 * Admin -> Analytics.
 *
 * There is nothing to fetch yet, and this file exists to say so rather than to pretend
 * otherwise: the page is static text describing what the view needs before it can be real.
 * It still waits for `profile`, because every page under /admin/ must go through the same
 * redirect-and-approval path as the others - a page that renders for a signed-out visitor,
 * even one showing nothing, is a page that behaves differently from its neighbours.
 */
profile.then(() => say(""));
