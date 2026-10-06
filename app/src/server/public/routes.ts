import type { z } from "zod";
import {
  analyticsBatchSchema,
  clientErrorSchema,
  conciergeQuestionSchema,
  inquirySchema,
  searchQuerySchema,
  slugSchema,
  subjectRequestSchema,
  submissionSchema,
  subscriberSchema,
} from "../../domain/contracts";
import { cspReportBatchSchema } from "../../domain/csp-report";
import {
  getMarket,
  getProperty,
  getStory,
  listMarkets,
  listProperties,
  listStories,
} from "../catalog/service";
import * as clientErrors from "../client-errors/service";
import * as concierge from "../concierge/service";
import * as events from "../events/service";
import * as hooks from "../hooks/resend";
import * as inquiries from "../inquiries/service";
import type { Db } from "../lib/db";
import type { env } from "../lib/env";
import type { WaitUntil } from "../lib/wait-until";
import * as search from "../search/service";
import * as subjects from "../subjects/service";
import * as submissions from "../submissions/service";
import * as subscribers from "../subscribers/service";

// The public route table as data (architecture 4.1): the one source for the handlers, the in-process
// dispatcher and the tests. `handlePublic` reads it; a route file only calls `handlePublic`.

type Env = typeof env;

export interface PublicCtx {
  requestId: string;
  ipHash: string;
  turnstileOk: boolean;
  /** Keeps work running after the response (`waitUntil`); the collector of a test. */
  wait: WaitUntil;
  env: Env;
}

export interface RouteLimit {
  scope: "ip" | "email";
  store: "db" | "memory";
  limit: number;
  windowSeconds: number;
}

/** The edge part of a cached read. `$slug` in a tag stands for the path parameter. */
export interface RouteCache {
  sMaxAge: number;
  tags: readonly string[];
}

// One signature for every service: it takes the value its row's schema parsed, whatever that is
// (the `:slug` string of a detail read, the JSON body of a write, nothing for a list).
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the table holds services of different inputs under one type
export type PublicService = (db: Db, input: any, ctx: PublicCtx) => Promise<unknown>;

/** A `raw` row reads its own body (a signed webhook), so the pipeline reads none of it. */
export type RawService = (request: Request, db: Db, env: Env) => Promise<Response>;

interface BaseRoute {
  /** Absolute, with `:name` for a path parameter. */
  path: string;
  method: "GET" | "POST";
  limits: RouteLimit[];
  turnstile: boolean;
  /** The four form writes also take a first memory check before any other work. */
  form?: boolean;
  /** The body types a write accepts; `application/json` when absent. */
  contentTypes?: readonly string[];
  cache?: RouteCache;
  status: number;
}

export type PublicRoute =
  | (BaseRoute & {
      raw?: false;
      schema?: z.ZodType<unknown, z.ZodTypeDef, unknown>;
      service: PublicService;
    })
  | (BaseRoute & { raw: true; service: RawService });

const EDGE_LIFETIME = 31_536_000;
const HOUR = 3600;
const DAY = 86_400;

const catalogRead = (
  path: string,
  service: PublicService,
  detail?: { tag: string },
): PublicRoute => ({
  path,
  method: "GET",
  ...(detail !== undefined && { schema: slugSchema }),
  limits: [],
  turnstile: false,
  cache: {
    sMaxAge: EDGE_LIFETIME,
    tags: detail === undefined ? ["catalog"] : ["catalog", `${detail.tag}:$slug`],
  },
  status: 200,
  service,
});

export const routes: PublicRoute[] = [
  catalogRead("/api/public/properties", listProperties),
  catalogRead("/api/public/properties/:slug", getProperty, { tag: "property" }),
  catalogRead("/api/public/markets", listMarkets),
  catalogRead("/api/public/markets/:slug", getMarket, { tag: "market" }),
  catalogRead("/api/public/stories", listStories),
  catalogRead("/api/public/stories/:slug", getStory, { tag: "story" }),
  {
    path: "/api/public/inquiries",
    method: "POST",
    schema: inquirySchema,
    limits: [
      { scope: "ip", store: "db", limit: 10, windowSeconds: HOUR },
      { scope: "email", store: "db", limit: 5, windowSeconds: HOUR },
    ],
    turnstile: true,
    form: true,
    status: 201,
    service: inquiries.create,
  },
  {
    path: "/api/public/submissions",
    method: "POST",
    schema: submissionSchema,
    limits: [
      { scope: "ip", store: "db", limit: 3, windowSeconds: HOUR },
      { scope: "email", store: "db", limit: 5, windowSeconds: DAY },
    ],
    turnstile: true,
    form: true,
    status: 201,
    service: submissions.create,
  },
  {
    path: "/api/public/submissions/:id/uploads",
    method: "POST",
    schema: submissions.signMoreSchema,
    limits: [{ scope: "ip", store: "db", limit: 12, windowSeconds: HOUR }],
    turnstile: false,
    status: 200,
    service: submissions.signMore,
  },
  {
    path: "/api/public/subscribers",
    method: "POST",
    schema: subscriberSchema,
    limits: [
      { scope: "ip", store: "db", limit: 5, windowSeconds: HOUR },
      { scope: "email", store: "db", limit: 3, windowSeconds: HOUR },
    ],
    turnstile: true,
    form: true,
    status: 201,
    service: subscribers.subscribe,
  },
  {
    // No schema and no cache: the service parses the query itself, so a bad token lands on ?confirmed=0.
    path: "/api/public/subscribers/confirm",
    method: "GET",
    limits: [{ scope: "ip", store: "db", limit: 20, windowSeconds: HOUR }],
    turnstile: false,
    status: 303,
    service: subscribers.confirm,
  },
  {
    path: "/api/public/subjects/request",
    method: "POST",
    schema: subjectRequestSchema,
    limits: [
      { scope: "ip", store: "db", limit: 3, windowSeconds: DAY },
      { scope: "email", store: "db", limit: 2, windowSeconds: DAY },
    ],
    turnstile: true,
    form: true,
    status: 201,
    service: subjects.request,
  },
  {
    path: "/api/public/events",
    method: "POST",
    schema: analyticsBatchSchema,
    limits: [{ scope: "ip", store: "memory", limit: 120, windowSeconds: 60 }],
    turnstile: false,
    status: 204,
    service: events.record,
  },
  {
    // The browser sends the report itself, so there is no Turnstile check and no database limit.
    path: "/api/public/csp-report",
    method: "POST",
    schema: cspReportBatchSchema,
    contentTypes: ["application/reports+json", "application/csp-report"],
    limits: [{ scope: "ip", store: "memory", limit: 60, windowSeconds: 60 }],
    turnstile: false,
    status: 204,
    service: events.recordCspReports,
  },
  {
    path: "/api/public/search",
    method: "POST",
    schema: searchQuerySchema,
    limits: [{ scope: "ip", store: "memory", limit: 60, windowSeconds: 60 }],
    turnstile: false,
    status: 200,
    service: search.match,
  },
  {
    path: "/api/public/concierge",
    method: "POST",
    schema: conciergeQuestionSchema,
    limits: [{ scope: "ip", store: "memory", limit: 30, windowSeconds: 60 }],
    turnstile: false,
    status: 200,
    service: concierge.answer,
  },
  {
    path: "/api/public/client-error",
    method: "POST",
    schema: clientErrorSchema,
    limits: [{ scope: "ip", store: "memory", limit: 30, windowSeconds: 60 }],
    turnstile: false,
    status: 204,
    service: clientErrors.report,
  },
  {
    path: "/api/hooks/resend",
    method: "POST",
    raw: true,
    limits: [],
    turnstile: false,
    status: 200,
    service: hooks.handleResend,
  },
];
