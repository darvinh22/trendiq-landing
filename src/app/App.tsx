import { useState, useMemo } from "react";
import { Search, Sparkles, Bell, TrendingUp, Cpu, Home, Dumbbell, Shirt, Plane, Flame, BarChart3 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { PRODUCTS, CATEGORIES, type Product, type Category } from "./components/data";
import { ProductCard } from "./components/ProductCard";
import { ProductDetail } from "./components/ProductDetail";
import { CompareScreen } from "./components/CompareScreen";
import { ForYouScreen } from "./components/ForYouScreen";

{/* MARKER-MAKE-KIT-INVOKED */}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  All: <Sparkles size={13} />,
  Tech: <Cpu size={13} />,
  Gadgets: <BarChart3 size={13} />,
  "AI Products": <Sparkles size={13} />,
  Home: <Home size={13} />,
  Fitness: <Dumbbell size={13} />,
  Fashion: <Shirt size={13} />,
  Travel: <Plane size={13} />,
  "Viral TikTok": <Flame size={13} />,
  "Consumer Trends": <TrendingUp size={13} />,
};

type Tab = "trending" | "discover" | "compare" | "foryou";

const NAV_ITEMS: { id: Tab; icon: React.ReactNode; label: string }[] = [
  { id: "trending", icon: <Flame size={18} />, label: "Trending" },
  { id: "discover", icon: <Search size={18} />, label: "Discover" },
  { id: "compare", icon: <BarChart3 size={18} />, label: "Compare" },
  { id: "foryou", icon: <Sparkles size={18} />, label: "For You" },
];

export default function App() {
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<Category | "All">("All");
  const [activeTab, setActiveTab] = useState<Tab>("trending");

  const filteredProducts = useMemo(() => {
    return PRODUCTS.filter((p) => {
      const matchesCategory = activeCategory === "All" || p.category === activeCategory;
      const matchesSearch =
        !searchQuery ||
        p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.subtitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.trendiqSays.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [searchQuery, activeCategory]);

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    setSelectedProduct(null);
  };

  return (
    <div
      className="size-full flex items-center justify-center"
      style={{ background: "#04050A", fontFamily: "'Inter', sans-serif" }}
    >
      {/* Phone frame */}
      <div
        className="relative flex flex-col overflow-hidden"
        style={{
          width: "min(390px, 100%)",
          height: "min(844px, 100%)",
          background: "var(--background)",
          borderRadius: "clamp(0px, 4vw, 44px)",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.06), 0 40px 80px rgba(0,0,0,0.8), 0 0 120px rgba(24,211,209,0.04)",
        }}
      >
        <AnimatePresence mode="wait">
          {selectedProduct ? (
            <motion.div
              key="detail"
              initial={{ x: "100%", opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: "100%", opacity: 0 }}
              transition={{ type: "spring", damping: 28, stiffness: 280 }}
              className="absolute inset-0"
              style={{ zIndex: 10 }}
            >
              <ProductDetail product={selectedProduct} onBack={() => setSelectedProduct(null)} />
            </motion.div>
          ) : (
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="flex flex-col h-full min-h-0"
            >
              {/* ── TRENDING / DISCOVER ── */}
              {(activeTab === "trending" || activeTab === "discover") && (
                <>
                  {/* Header */}
                  <div
                    className="flex items-center justify-between px-6 pt-4 pb-2 shrink-0"
                    style={{ borderBottom: "1px solid var(--border)" }}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          style={{
                            color: "#18D3D1",
                            fontWeight: 800,
                            fontSize: "1.5rem",
                            letterSpacing: "-0.03em",
                          }}
                        >
                          TrendIQ
                        </span>
                        <div
                          className="px-1.5 py-0.5 rounded-md"
                          style={{
                            background: "rgba(24,211,209,0.12)",
                            border: "1px solid rgba(24,211,209,0.2)",
                          }}
                        >
                          <span style={{ color: "#18D3D1", fontSize: "0.55rem", fontWeight: 700, letterSpacing: "0.08em" }}>
                            BETA
                          </span>
                        </div>
                      </div>
                      <p style={{ color: "var(--muted-foreground)", fontSize: "0.72rem", marginTop: "1px" }}>
                        Find what's worth the hype.
                      </p>
                    </div>
                    <button
                      className="w-9 h-9 flex items-center justify-center rounded-full"
                      style={{ background: "var(--secondary)", border: "1px solid var(--border)" }}
                    >
                      <Bell size={15} style={{ color: "var(--muted-foreground)" }} />
                    </button>
                  </div>

                  {/* Search bar */}
                  <div className="px-4 py-3 shrink-0">
                    <div
                      className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-2xl"
                      style={{ background: "var(--secondary)", border: "1px solid var(--border)" }}
                    >
                      <Search size={15} style={{ color: "var(--muted-foreground)", flexShrink: 0 }} />
                      <input
                        type="text"
                        placeholder="Search products, trends…"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="flex-1 bg-transparent outline-none"
                        style={{ color: "var(--foreground)", fontSize: "0.85rem", border: "none" }}
                      />
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery("")}
                          className="w-4 h-4 flex items-center justify-center rounded-full shrink-0"
                          style={{ background: "var(--muted-foreground)" }}
                        >
                          <span style={{ color: "var(--background)", fontSize: "0.6rem", fontWeight: 700 }}>×</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Category chips */}
                  <div
                    className="shrink-0 overflow-x-auto px-4 pb-3"
                    style={{ scrollbarWidth: "none" }}
                  >
                    <div className="flex gap-2 w-max">
                      {["All", ...CATEGORIES].map((cat) => {
                        const isActive = activeCategory === cat;
                        return (
                          <button
                            key={cat}
                            onClick={() => setActiveCategory(cat as Category | "All")}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all duration-150 shrink-0"
                            style={{
                              background: isActive ? "rgba(24,211,209,0.12)" : "var(--secondary)",
                              border: isActive ? "1px solid rgba(24,211,209,0.3)" : "1px solid var(--border)",
                              color: isActive ? "#18D3D1" : "var(--muted-foreground)",
                              fontSize: "0.72rem",
                              fontWeight: isActive ? 600 : 400,
                              boxShadow: isActive ? "0 0 12px rgba(24,211,209,0.15)" : "none",
                            }}
                          >
                            {CATEGORY_ICONS[cat]}
                            {cat}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Section header */}
                  <div className="flex items-center justify-between px-4 mb-2 shrink-0">
                    <div className="flex items-center gap-2">
                      <Flame size={13} style={{ color: "#FF6314" }} />
                      <span style={{ color: "var(--foreground)", fontSize: "0.78rem", fontWeight: 700 }}>
                        {activeCategory === "All" ? "Trending Now" : activeCategory}
                      </span>
                      <span
                        className="px-1.5 py-0.5 rounded-md"
                        style={{ background: "rgba(255,99,20,0.12)", color: "#FF6314", fontSize: "0.6rem", fontWeight: 700 }}
                      >
                        {filteredProducts.length}
                      </span>
                    </div>
                    <span style={{ color: "var(--muted-foreground)", fontSize: "0.7rem" }}>See all</span>
                  </div>

                  {/* Feed */}
                  <div
                    className="flex-1 overflow-y-auto px-4 pb-6"
                    style={{ scrollbarWidth: "none" }}
                  >
                    {filteredProducts.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-40 gap-2">
                        <Search size={28} style={{ color: "var(--muted-foreground)", opacity: 0.4 }} />
                        <p style={{ color: "var(--muted-foreground)", fontSize: "0.82rem" }}>No results found</p>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3">
                        {filteredProducts.map((product) => (
                          <motion.div
                            key={product.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.2 }}
                          >
                            <ProductCard product={product} onTap={setSelectedProduct} />
                          </motion.div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* ── COMPARE ── */}
              {activeTab === "compare" && <CompareScreen />}

              {/* ── FOR YOU ── */}
              {activeTab === "foryou" && <ForYouScreen onTapProduct={setSelectedProduct} />}

              {/* Bottom nav */}
              <div
                className="shrink-0 flex items-center justify-around py-3 px-6"
                style={{
                  position: "sticky",
                  bottom: 0,
                  zIndex: 20,
                  background: "var(--card)",
                  borderTop: "1px solid var(--border)",
                }}
              >
                {NAV_ITEMS.map(({ id, icon, label }) => {
                  const active = activeTab === id;
                  return (
                    <button
                      key={id}
                      onClick={() => handleTabChange(id)}
                      className="flex flex-col items-center gap-1"
                    >
                      <span style={{ color: active ? "#18D3D1" : "var(--muted-foreground)" }}>{icon}</span>
                      <span
                        style={{
                          color: active ? "#18D3D1" : "var(--muted-foreground)",
                          fontSize: "0.6rem",
                          fontWeight: active ? 600 : 400,
                        }}
                      >
                        {label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
