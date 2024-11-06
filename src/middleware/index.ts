import { defineMiddleware, sequence } from "astro:middleware";

import { logger } from "./logger";
import { auth } from "./auth";

export const redirect = defineMiddleware(async ({ url }, next) => {
  // if the host is a www host, redirect to the non-www version
  if (url.host.startsWith("www.")) {
    return new Response(null, {
      status: 301,
      headers: {
        Location: url.href.replace("www.", ""),
      },
    });
  }

  return next();
});

export const onRequest = sequence(redirect, logger, auth);
