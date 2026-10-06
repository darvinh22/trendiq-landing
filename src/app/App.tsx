import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Search, ShieldCheck, Sparkles } from "lucide-react";
import { ProductAnalysisScreen } from "./components/ProductAnalysisScreen";
import {
  productAnalysisClient,
  type ProductAnalysisClient,
} from "./lib/analysis/productAnalysisClient";
import type { ControlledProductCatalogItem } from "./lib/analysis/productAnalysisContract";

type CatalogState =
  | { phase: "loading" }
  | { phase: "ready"; products: ControlledProductCatalogItem[] }
  | { phase: "error" };

export function filterControlledCatalog(
  products: readonly ControlledProductCatalogItem[],
  query: string
): ControlledProductCatalogItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [...products];

  return products.filter((product) =>
    [product.productId, product.displayName, product.brand, product.category]
      .some((value) => value.toLowerCase().includes(normalizedQuery))
  );
}

export async function loadControlledCatalog(client: ProductAnalysisClient) {
  return client.listCatalog();
}

interface ControlledCatalogViewProps {
  products: readonly ControlledProductCatalogItem[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSelect: (product: ControlledProductCatalogItem) => void;
}

export function ControlledCatalogView({
  products,
  searchQuery,
  onSearchChange,
  onSelect,
}: ControlledCatalogViewProps) {
  const filteredProducts = useMemo(
    () => filterControlledCatalog(products, searchQuery),
    [products, searchQuery]
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="px-6 pt-6 pb-4" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2">
          <span style={{ color: "#18D3D1", fontWeight: 800, fontSize: "1.5rem", letterSpacing: "-0.03em" }}>
            TrendIQ
          </span>
          <span
            className="px-2 py-1 rounded-md"
            style={{ background: "rgba(24,211,209,0.12)", color: "#18D3D1", fontSize: "0.58rem", fontWeight: 800 }}
          >
            CONTROLLED ALPHA
          </span>
        </div>
        <p style={{ color: "var(--foreground)", fontSize: "1rem", fontWeight: 800, lineHeight: 1.4, marginTop: 8 }}>
          Find what&apos;s worth the hype.
        </p>
        <p style={{ color: "var(--muted-foreground)", fontSize: "0.75rem", lineHeight: 1.5, marginTop: 4 }}>
          TrendIQ uses supported evidence to help you decide whether a product is worth considering.
        </p>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4" style={{ scrollbarWidth: "none" }}>
        <div
          className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl mb-4"
          style={{ background: "var(--secondary)", border: "1px solid var(--border)" }}
        >
          <Search size={15} style={{ color: "var(--muted-foreground)", flexShrink: 0 }} />
          <input
            type="search"
            aria-label="Filter controlled products"
            placeholder="Filter controlled products"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            className="flex-1 bg-transparent outline-none"
            style={{ color: "var(--foreground)", fontSize: "0.82rem", border: "none" }}
          />
        </div>

        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck size={14} style={{ color: "#18D3D1" }} />
          <p style={{ color: "var(--muted-foreground)", fontSize: "0.7rem", lineHeight: 1.45 }}>
            Browsing and filtering do not start an analysis. A fresh evidence check starts only after you choose Analyze.
          </p>
        </div>

        {filteredProducts.length === 0 ? (
          <div className="rounded-2xl p-5 text-center" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <p style={{ color: "var(--foreground)", fontSize: "0.8rem", fontWeight: 700 }}>No controlled products match.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {filteredProducts.map((product) => (
              <button
                key={product.productId}
                onClick={() => onSelect(product)}
                className="w-full rounded-2xl p-4 text-left"
                style={{ background: "var(--card)", border: "1px solid var(--border)" }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 style={{ color: "var(--foreground)", fontSize: "0.95rem", fontWeight: 800 }}>
                      {product.displayName}
                    </h2>
                    <p style={{ color: "var(--muted-foreground)", fontSize: "0.72rem", marginTop: 3 }}>
                      {product.brand} · {product.category}
                    </p>
                  </div>
                  <ArrowRight size={17} style={{ color: "#18D3D1", flexShrink: 0, marginTop: 2 }} />
                </div>
                <div className="flex items-center gap-1.5 mt-4">
                  <Sparkles size={13} style={{ color: "#18D3D1" }} />
                  <span style={{ color: "#18D3D1", fontSize: "0.7rem", fontWeight: 700 }}>
                    View product analysis
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

export interface AppProps {
  client?: ProductAnalysisClient;
}

export default function App({ client = productAnalysisClient }: AppProps) {
  const [catalogState, setCatalogState] = useState<CatalogState>({ phase: "loading" });
  const [selectedProduct, setSelectedProduct] = useState<ControlledProductCatalogItem | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadControlledCatalog(client).then((catalog) => {
      if (cancelled) return;
      setCatalogState(catalog ? { phase: "ready", products: catalog.products } : { phase: "error" });
    });
    return () => {
      cancelled = true;
    };
  }, [client]);

  return (
    <div
      className="fixed inset-0 flex h-dvh max-h-dvh min-h-0 w-full items-center justify-center overflow-hidden"
      style={{ background: "#04050A", fontFamily: "'Inter', sans-serif" }}
    >
      <div
        className="relative flex h-full min-h-0 w-full max-w-[390px] flex-col overflow-hidden"
        style={{
          width: "min(390px, 100%)",
          height: "min(844px, 100%)",
          maxHeight: "100%",
          background: "var(--background)",
          borderRadius: "clamp(0px, 4vw, 44px)",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.06), 0 40px 80px rgba(0,0,0,0.8)",
        }}
      >
        {selectedProduct ? (
          <ProductAnalysisScreen
            product={selectedProduct}
            onBack={() => setSelectedProduct(null)}
            client={client}
          />
        ) : catalogState.phase === "ready" ? (
          <ControlledCatalogView
            products={catalogState.products}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onSelect={setSelectedProduct}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center" aria-live="polite">
            <ShieldCheck size={24} style={{ color: catalogState.phase === "loading" ? "#18D3D1" : "#FFB547" }} />
            <p style={{ color: "var(--foreground)", fontSize: "0.82rem", fontWeight: 700 }}>
              {catalogState.phase === "loading" ? "Loading controlled catalog…" : "Controlled catalog unavailable"}
            </p>
            <p style={{ color: "var(--muted-foreground)", fontSize: "0.7rem", lineHeight: 1.5 }}>
              {catalogState.phase === "loading"
                ? "No analysis runs while the catalog loads."
                : "No product analysis is available from this page right now."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
