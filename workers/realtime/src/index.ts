import type { Env } from './env';
import { handleRequest } from './router';
import { RealtimeSession } from './durable/RealtimeSession';

const handler: ExportedHandler<Env> = {
  fetch(request, env, ctx) {
    return handleRequest(request, env, ctx);
  }
};

export default handler;
export { RealtimeSession };
