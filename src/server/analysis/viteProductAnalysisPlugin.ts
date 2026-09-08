import type { Connect, Plugin } from "vite";
import { handleProductAnalysisHttpRequest } from "../runtime/productAnalysisHttp";
import {
  createProductAnalysisRuntime,
  type ProductAnalysisRuntime,
} from "../runtime/productAnalysisRuntime";

function middleware(runtime: ProductAnalysisRuntime): Connect.NextHandleFunction {
  return async (request, response, next) => {
    if (!await handleProductAnalysisHttpRequest(request, response, runtime)) next();
  };
}

export function productAnalysisApiPlugin(
  runtime = createProductAnalysisRuntime({ assetsReady: () => true })
): Plugin {
  const handler = middleware(runtime);

  return {
    name: "trendiq-controlled-product-analysis-api",
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}
