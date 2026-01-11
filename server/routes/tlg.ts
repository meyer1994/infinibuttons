import { webhookCallback } from "grammy";
import { Update } from "grammy/types";
import { eventHandler, type H3Event } from "h3";

/**
 * Abstraction over a request-response cycle, providing access to the update, as
 * well as a mechanism for responding to the request and to end it.
 * 
 * Copied from:
 * https://github.com/grammyjs/grammY/blob/99a89e91f71fc21e00036b5a4fe48ea09b203da6/src/convenience/frameworks.ts#L21C1-L56C2
 */
export interface ReqResHandler<T = void> {
  /**
   * The update object sent from Telegram, usually resolves the request's JSON
   * body
   */
  update: Update | Promise<Update>;
  /**
   * X-Telegram-Bot-Api-Secret-Token header of the request, or undefined if
   * not present
   */
  header?: string;
  /**
   * Ends the request immediately without body, called after every request
   * unless a webhook reply was performed
   */
  end?: () => void;
  /**
   * Sends the specified JSON as a payload in the body, used for webhook
   * replies
   */
  respond: (json: string) => unknown | Promise<unknown>;
  /**
   * Responds that the request is unauthorized due to mismatching
   * X-Telegram-Bot-Api-Secret-Token headers
   */
  unauthorized: () => unknown | Promise<unknown>;
  /**
   * Some frameworks (e.g. Deno's std/http `listenAndServe`) assume that
   * handler returns something
   */
  handlerReturn?: Promise<T>;
}


type NitroModuleAdapter = (event: H3Event) => ReqResHandler<Update>

/** Native CloudFlare workers (module worker) */
const nitroModule: NitroModuleAdapter = (event) => {
  return {
      get update() { 
        return readBody(event) as Promise<Update> 
    },

      header: getHeader(event, 'X-Telegram-Bot-Api-Secret-Token') || undefined,

      end: () => setResponseStatus(event, 200),

      respond: async (json: string) => {
        setResponseStatus(event, 200);
        setHeader(event, 'Content-Type', 'application/json');
        await sendStream(event, new ReadableStream({
          start(controller) {
            controller.enqueue(json);
            controller.close();
          },
        }));
      },

      unauthorized: async () => {
        setResponseStatus(event, 401);
        setResponseHeader(event, 'Content-Type', 'application/json');
        await sendStream(event, new ReadableStream({
          start(controller) {
            controller.enqueue('secret token is wrong');
            controller.close();
          },
        }));
      },
  };
};

// Learn more: https://nitro.build/guide/routing
export default eventHandler(async (event) => {
  return await webhookCallback(event.context.bot, nitroModule)(event);
});
