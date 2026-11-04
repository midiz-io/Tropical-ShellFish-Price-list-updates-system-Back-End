// routes/local-product-prices.js
// Manages local pricing for products (profit, selling_price per variant)
import express from "express";
import supabase from "../db.js";

const router = express.Router();
const sf = (v, d = 0) => (isFinite(parseFloat(v)) ? parseFloat(v) : d);

// ── GET all local prices (joined with product info) ─────────────
// GET /api/local-product-prices
router.get("/", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("local_product_prices")
      .select(
        "*, products(id, common_name, scientific_name, category, species_type, image_url, variants)",
      );
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET full local product list (products + their local prices) ─
// GET /api/local-product-prices/full-list
// Returns products that have at least one local price entry,
// with pricing merged into variants
router.get("/full-list", async (req, res) => {
  try {
    // Fetch all products
    const { data: products, error: prodErr } = await supabase
      .from("products")
      .select("*")
      .order("common_name");
    if (prodErr) throw prodErr;

    // Fetch all local prices
    const { data: prices, error: priceErr } = await supabase
      .from("local_product_prices")
      .select("*");
    if (priceErr) throw priceErr;

    // Build a map: product_id → { variant_id → price row }
    const priceMap = {};
    for (const p of prices || []) {
      if (!priceMap[p.product_id]) priceMap[p.product_id] = {};
      priceMap[p.product_id][String(p.variant_id)] = p;
    }

    // Merge: only return products that have at least one local price
    const result = [];
    for (const product of products || []) {
      const productPrices = priceMap[product.id];
      if (!productPrices || Object.keys(productPrices).length === 0) continue;

      // Get categories from any price row (they're set per product, same for all variants)
      const anyPriceRow = Object.values(productPrices)[0];
      const localCategories = anyPriceRow?.categories?.length
        ? anyPriceRow.categories
        : product.categories?.length
          ? product.categories
          : product.category
            ? [product.category]
            : [];

      const variants = (product.variants || []).map((v) => {
        const lp = productPrices[String(v.id)];
        return {
          ...v,
          profit: lp ? sf(lp.profit) : 0,
          selling_price: lp ? sf(lp.selling_price) : sf(v.purchasing_price),
          profit_margin_percentage: lp ? sf(lp.profit_margin_percentage) : 0,
          has_local_price: !!lp,
          local_price_id: lp?.id || null,
        };
      });

      result.push({
        ...product,
        categories: localCategories,
        category: localCategories[0] || product.category,
        variants,
      });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET prices for a specific product ──────────────────────────
// GET /api/local-product-prices/product/:productId
router.get("/product/:productId", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("local_product_prices")
      .select("*")
      .eq("product_id", req.params.productId);
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST — add local pricing for a product variant ─────────────
// POST /api/local-product-prices
// Body: { product_id, variant_id, profit, selling_price, profit_margin_percentage }
router.post("/", async (req, res) => {
  try {
    const {
      product_id,
      variant_id,
      profit,
      selling_price,
      profit_margin_percentage,
    } = req.body;
    if (!product_id)
      return res.status(400).json({ error: "product_id required" });

    const pp = sf(profit);
    const sp = sf(selling_price);
    const pmp = sf(profit_margin_percentage);

    const { data, error } = await supabase
      .from("local_product_prices")
      .upsert(
        {
          product_id: parseInt(product_id),
          variant_id: variant_id ? parseInt(variant_id) : null,
          profit: pp,
          selling_price: sp,
          profit_margin_percentage: pmp,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "product_id,variant_id" },
      )
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT (bulk) — set pricing for multiple variants at once ──────
// PUT /api/local-product-prices/bulk
// Body: { product_id, variants: [{ variant_id, profit, selling_price, profit_margin_percentage }] }
router.put("/bulk", async (req, res) => {
  try {
    const { product_id, variants, categories } = req.body;
    if (!product_id || !Array.isArray(variants)) {
      return res
        .status(400)
        .json({ error: "product_id and variants[] required" });
    }

    const pid = parseInt(product_id);

    // Delete all existing local prices for this product, then re-insert
    // This avoids upsert null-matching issues with variant_id
    const { error: delError } = await supabase
      .from("local_product_prices")
      .delete()
      .eq("product_id", pid);

    if (delError) throw delError;

    const rows = variants.map((v) => ({
      product_id: pid,
      variant_id: v.variant_id ? Math.floor(parseFloat(v.variant_id)) : null,
      profit: sf(v.profit),
      selling_price: sf(v.selling_price),
      profit_margin_percentage: sf(v.profit_margin_percentage),
      categories: categories || [],
      updated_at: new Date().toISOString(),
    }));

    const { data, error } = await supabase
      .from("local_product_prices")
      .insert(rows)
      .select();

    if (error) throw error;

    // Cascade to customer_product
    for (const v of variants) {
      await cascadeToCustomerProduct(pid, v.variant_id, sf(v.profit));
    }

    res.json({ updated: (data || []).length, results: data });
  } catch (err) {
    console.error("[bulk PUT]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT — update local pricing ─────────────────────────────────
// PUT /api/local-product-prices/:id
router.put("/:id", async (req, res) => {
  try {
    const { profit, selling_price, profit_margin_percentage } = req.body;

    // Also cascade to customer_product if purchasing_price changed
    const { data: existing } = await supabase
      .from("local_product_prices")
      .select("product_id, variant_id")
      .eq("id", req.params.id)
      .single();

    const { data, error } = await supabase
      .from("local_product_prices")
      .update({
        profit: sf(profit),
        selling_price: sf(selling_price),
        profit_margin_percentage: sf(profit_margin_percentage),
        updated_at: new Date().toISOString(),
      })
      .eq("id", req.params.id)
      .select()
      .single();

    if (error) throw error;

    // Cascade new profit to customer_product
    if (existing) {
      await cascadeToCustomerProduct(
        existing.product_id,
        existing.variant_id,
        sf(profit),
      );
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE — remove local pricing for a variant ────────────────
// DELETE /api/local-product-prices/:id
router.delete("/:id", async (req, res) => {
  try {
    const { error } = await supabase
      .from("local_product_prices")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ message: "Local price deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CASCADE: when local price changes, update customer_product ──
// Cascade: when local profit changes → update customer_product selling price
// Uses customer's own purchasing_price + new profit to recalculate
async function cascadeToCustomerProduct(productId, variantId, newProfit) {
  try {
    let query = supabase
      .from("customer_product")
      .select("id, purchasing_price")
      .eq("product_id", productId);

    if (variantId) query = query.eq("variant_id", variantId);

    const { data: rows, error } = await query;
    if (error || !rows?.length) return;

    for (const cp of rows) {
      const pp = sf(cp.purchasing_price);
      const sp = pp + sf(newProfit);
      const pmp = sp > 0 ? (sf(newProfit) / sp) * 100 : 0;

      await supabase
        .from("customer_product")
        .update({
          margin: parseFloat(sf(newProfit).toFixed(2)),
          selling_price: parseFloat(sp.toFixed(2)),
          margin_percentage: parseFloat(pmp.toFixed(4)),
        })
        .eq("id", cp.id);
    }
    console.log(
      `[cascade] Updated ${(rows || []).length} customer_product rows for product ${productId}`,
    );
  } catch (err) {
    console.error("[cascadeToCustomerProduct] error:", err.message);
  }
}

// DELETE /api/local-product-prices/product/:productId — remove from local list
router.delete("/product/:productId", async (req, res) => {
  try {
    const { error } = await supabase
      .from("local_product_prices")
      .delete()
      .eq("product_id", req.params.productId);
    if (error) throw error;
    res.json({ message: "Product removed from local list" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
