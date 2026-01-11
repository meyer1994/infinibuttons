import nitroCloudflareBindings from "nitro-cloudflare-dev";
import { defineNitroConfig } from "nitropack/config";

// https://nitro.build/config
export default defineNitroConfig({
  compatibilityDate: "latest",
  srcDir: "server",
  experimental: { database: true },

  modules: [nitroCloudflareBindings],

  preset: "cloudflare_module",
  cloudflare: {
    deployConfig: true,
    nodeCompat: true
  },
});
