import type { UserFromGetMe } from "grammy/types";
import nitroCloudflareBindings from "nitro-cloudflare-dev";
import { defineNitroConfig } from "nitropack/config";

// https://nitro.build/config
export default defineNitroConfig({
  compatibilityDate: "latest",
  srcDir: "server",
  experimental: { database: true },

  modules: [nitroCloudflareBindings],

  runtimeConfig: {
    BOT_TOKEN: process.env.NITRO_BOT_TOKEN as string | undefined,
    // @ts-expect-error
    BOT_INFO: process.env.NITRO_BOT_INFO as unknown as UserFromGetMe | undefined,
  },

  preset: "cloudflare_module",
  cloudflare: {
    deployConfig: true,
    nodeCompat: true
  },
});
