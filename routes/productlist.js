// routes/productlist.js — MASTER CATALOGUE
// Products are type-agnostic. variants only carry: { id, size, unit, purchasing_price }
// Local/sea/air pricing live in separate tables.
import express from "express";
import supabase from "../db.js";
import multer from "multer";
import path from "path";

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage });
const sf = (v, d = 0) => (isFinite(parseFloat(v)) ? parseFloat(v) : d);

async function uploadImage(file) {
  const fileName = `${Date.now()}${path.extname(file.originalname)}`;
  const { error } = await supabase.storage
    .from("product-images")
    .upload(fileName, file.buffer, { contentType: file.mimetype });
  if (error) throw error;
  const {
    data: { publicUrl },
  } = supabase.storage.from("product-images").getPublicUrl(fileName);
  return publicUrl;
}

router.get("/", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("common_name");
    if (error) throw error;
    const result = (data || []).map((p) => ({
      ...p,
      variants: Array.isArray(p.variants)
        ? [...p.variants].sort(
            (a, b) =>
              sf(a.purchasing_price, 9999) - sf(b.purchasing_price, 9999),
          )
        : [],
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("id", req.params.id)
      .single();
    if (error)
      return res
        .status(error.code === "PGRST116" ? 404 : 500)
        .json({ error: error.message });
    if (!Array.isArray(data.variants)) data.variants = [];
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/upload", upload.single("image"), async (req, res) => {
  try {
    const {
      common_name,
      scientific_name,
      description,
      species_type,
      variants,
    } = req.body;
    const image_url = req.file ? await uploadImage(req.file) : null;
    const rawVariants = JSON.parse(
      typeof variants === "string" ? variants : JSON.stringify(variants || []),
    );
    const cleanVariants = rawVariants
      .map((v) => ({
        id: v.id || Date.now(),
        size: v.size || "",
        unit: v.unit || "kg",
        purchasing_price: sf(v.purchasing_price),
      }))
      .filter((v) => (v.size || "").trim());
    const { data, error } = await supabase
      .from("products")
      .insert({
        common_name,
        scientific_name,
        description,
        species_type,
        image_url,
        variants: cleanVariants,
      })
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.put("/upload/:id", upload.single("image"), async (req, res) => {
  try {
    const {
      common_name,
      scientific_name,
      description,
      species_type,
      existing_image_url,
      variants,
    } = req.body;
    const image_url = req.file
      ? await uploadImage(req.file)
      : existing_image_url;
    const rawVariants = JSON.parse(
      typeof variants === "string" ? variants : JSON.stringify(variants || []),
    );
    const cleanVariants = rawVariants
      .map((v) => ({
        id: v.id || Date.now(),
        size: v.size || "",
        unit: v.unit || "kg",
        purchasing_price: sf(v.purchasing_price),
      }))
      .filter((v) => (v.size || "").trim());

    const { data: old } = await supabase
      .from("products")
      .select("variants, image_url")
      .eq("id", req.params.id)
      .single();
    const { error } = await supabase
      .from("products")
      .update({
        common_name,
        scientific_name,
        description,
        species_type,
        image_url,
        variants: cleanVariants,
      })
      .eq("id", req.params.id);
    if (error) throw error;

    if (old?.variants) {
      for (const nv of cleanVariants) {
        const ov = old.variants.find((v) => String(v.id) === String(nv.id));
        if (!ov) continue;
        const ppChanged =
          Math.abs(sf(ov.purchasing_price) - sf(nv.purchasing_price)) > 0.001;
        if (!ppChanged) continue;
        await cascadeLocalPurchasePrice(
          req.params.id,
          nv.id,
          sf(nv.purchasing_price),
        );
        await cascadeExportProductPurchasePrice(
          "exportproducts",
          req.params.id,
          nv.id,
          sf(nv.purchasing_price),
        );
        await cascadeExportProductPurchasePrice(
          "exportproductsair",
          req.params.id,
          nv.id,
          sf(nv.purchasing_price),
        );
      }
    }

    if (image_url && old?.image_url !== image_url) {
      const pid = req.params.id;
      for (const table of ["exportproducts", "exportproductsair"]) {
        let { data: epRows } = await supabase
          .from(table)
          .select("id")
          .eq("product_id", pid);
        if (!epRows?.length) {
          const { data: master } = await supabase
            .from("products")
            .select("common_name")
            .eq("id", pid)
            .single();
          if (master?.common_name) {
            const { data } = await supabase
              .from(table)
              .select("id")
              .ilike("common_name", master.common_name);
            epRows = data || [];
          }
        }
        for (const row of epRows || []) {
          await supabase.from(table).update({ image_url }).eq("id", row.id);
        }
      }
      await supabase
        .from("exportcustomer_product")
        .update({ image_url })
        .eq("product_id", pid);
      await supabase
        .from("exportcustomer_productair")
        .update({ image_url })
        .eq("product_id", pid);
      console.log(`[cascade:image] ✅ updated image_url for product ${pid}`);
    }

    const { data: updated } = await supabase
      .from("products")
      .select("*")
      .eq("id", req.params.id)
      .single();
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const { error } = await supabase
      .from("products")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ message: "Product deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:productId/variants", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("products")
      .select("variants")
      .eq("id", req.params.productId)
      .single();
    if (error) throw error;
    res.json(data.variants || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:productId/variants", async (req, res) => {
  const { productId } = req.params;
  try {
    const { data: prod, error: fe } = await supabase
      .from("products")
      .select("variants")
      .eq("id", productId)
      .single();
    if (fe) throw fe;
    const variants = Array.isArray(prod.variants) ? prod.variants : [];
    const newVar = {
      id: Date.now(),
      size: req.body.size || "",
      unit: req.body.unit || "kg",
      purchasing_price: sf(req.body.purchasing_price),
    };
    const { error } = await supabase
      .from("products")
      .update({ variants: [...variants, newVar] })
      .eq("id", productId);
    if (error) throw error;
    res.status(201).json(newVar);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/:productId/variants/:variantId", async (req, res) => {
  const { productId, variantId } = req.params;
  try {
    const { data: prod, error: fe } = await supabase
      .from("products")
      .select("variants")
      .eq("id", productId)
      .single();
    if (fe) throw fe;
    const variants = Array.isArray(prod.variants) ? prod.variants : [];
    const old = variants.find((v) => String(v.id) === String(variantId));
    const newPP = sf(req.body.purchasing_price);
    const updated = variants.map((v) =>
      String(v.id) === String(variantId)
        ? {
            ...v,
            size: req.body.size || v.size,
            unit: req.body.unit || v.unit,
            purchasing_price: newPP,
          }
        : v,
    );
    const { error } = await supabase
      .from("products")
      .update({ variants: updated })
      .eq("id", productId);
    if (error) throw error;
    if (old && Math.abs(sf(old.purchasing_price) - newPP) > 0.001) {
      await cascadeLocalPurchasePrice(productId, variantId, newPP);
      await cascadeExportProductPurchasePrice(
        "exportproducts",
        productId,
        variantId,
        newPP,
      );
      await cascadeExportProductPurchasePrice(
        "exportproductsair",
        productId,
        variantId,
        newPP,
      );
    }
    res.json(updated.find((v) => String(v.id) === String(variantId)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:productId/variants/:variantId", async (req, res) => {
  const { productId, variantId } = req.params;
  try {
    const { data: prod, error: fe } = await supabase
      .from("products")
      .select("variants")
      .eq("id", productId)
      .single();
    if (fe) throw fe;
    const updated = (prod.variants || []).filter(
      (v) => String(v.id) !== String(variantId),
    );
    const { error } = await supabase
      .from("products")
      .update({ variants: updated })
      .eq("id", productId);
    if (error) throw error;
    res.json({ message: "Variant deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CASCADE HELPERS ────────────────────────────────────────────

async function cascadeLocalPurchasePrice(productId, variantId, newPP) {
  try {
    let lpq = supabase
      .from("local_product_prices")
      .select("id, profit, profit_margin_percentage")
      .eq("product_id", productId);
    if (variantId)
      lpq = lpq.eq("variant_id", Math.floor(parseFloat(variantId)));
    const { data: lpRows } = await lpq;
    for (const lp of lpRows || []) {
      const profit = sf(lp.profit);
      const sp = newPP + profit;
      const pmp = sp > 0 ? (profit / sp) * 100 : 0;
      await supabase
        .from("local_product_prices")
        .update({
          selling_price: parseFloat(sp.toFixed(2)),
          profit_margin_percentage: parseFloat(pmp.toFixed(4)),
          updated_at: new Date().toISOString(),
        })
        .eq("id", lp.id);
    }
    let q = supabase
      .from("customer_product")
      .select("id, margin")
      .eq("product_id", productId);
    if (variantId) q = q.eq("variant_id", variantId);
    const { data: rows } = await q;
    for (const cp of rows || []) {
      const margin = sf(cp.margin);
      const sp = newPP + margin;
      const pmp = sp > 0 ? (margin / sp) * 100 : 0;
      await supabase
        .from("customer_product")
        .update({
          purchasing_price: newPP,
          selling_price: parseFloat(sp.toFixed(2)),
          margin_percentage: parseFloat(pmp.toFixed(4)),
        })
        .eq("id", cp.id);
    }
  } catch (err) {
    console.error("[cascadeLocalPurchasePrice]", err.message);
  }
}

// Update purchasing_price inside exportproducts/exportproductsair variants JSONB
// Then recalculate exfactoryprice, fob_price and CNF for customer rows
async function cascadeExportProductPurchasePrice(
  table,
  productId,
  variantId,
  newPP,
) {
  try {
    const isAir = table === "exportproductsair";
    const customerTable = isAir
      ? "exportcustomer_productair"
      : "exportcustomer_product";

    // Find export product by product_id FK
    let { data: rows } = await supabase
      .from(table)
      .select("id, variants, common_name")
      .eq("product_id", productId);

    // Fallback: match by common_name
    if (!rows?.length) {
      const { data: master } = await supabase
        .from("products")
        .select("common_name")
        .eq("id", productId)
        .single();
      if (master?.common_name) {
        const { data } = await supabase
          .from(table)
          .select("id, variants, common_name")
          .ilike("common_name", master.common_name);
        rows = data || [];
      }
    }

    const { data: usdRow } = await supabase
      .from("usd_rates")
      .select("rate")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();
    const usdRate = sf(usdRow?.rate, 304);

    for (const row of rows || []) {
      if (!Array.isArray(row.variants)) continue;
      let changedVariant = null;

      const updatedVariants = row.variants.map((v) => {
        const idMatch =
          String(v.id) === String(variantId) ||
          Math.floor(parseFloat(v.id)) === Math.floor(parseFloat(variantId));
        if (!idMatch) return v;

        const labour = sf(v.labour_overhead);
        const packing = sf(v.packing_cost);
        // FIX: air table uses profit_usd, sea table uses profit
        const profitUSD = isAir ? sf(v.profit_usd) : sf(v.profit);
        const rate = sf(v.usdrate, usdRate);

        let newExFactory = sf(v.exfactoryprice);
        if (sf(v.purchasing_price) > 0 && !sf(v.jc_fob)) {
          newExFactory = newPP + (labour + packing + profitUSD) * rate;
        } else if (sf(v.jc_fob) > 0) {
          newExFactory = (sf(v.jc_fob) + profitUSD + packing + labour) * rate;
        }

        changedVariant = {
          ...v,
          purchasing_price: newPP,
          exfactoryprice: parseFloat(newExFactory.toFixed(2)),
        };
        return changedVariant;
      });

      if (changedVariant) {
        await supabase
          .from(table)
          .update({ variants: updatedVariants })
          .eq("id", row.id);
        console.log(
          `[cascade:${table}] ✅ updated variant in row ${row.id} — newExFactory=${changedVariant.exfactoryprice}`,
        );

        // Match customer rows by size_range (most reliable) then variant_id
        let custRows = [];
        const variantSize = changedVariant.size || "";

        if (variantSize) {
          // Primary: match by ep row id + size_range
          const { data: c1 } = await supabase
            .from(customerTable)
            .select("*")
            .eq("product_id", row.id)
            .eq("size_range", variantSize);
          custRows = c1 || [];
          // Also try master product_id + size_range
          if (!custRows.length) {
            const { data: c2 } = await supabase
              .from(customerTable)
              .select("*")
              .eq("product_id", productId)
              .eq("size_range", variantSize);
            custRows = c2 || [];
          }
        }

        // Fallback: variant_id match
        if (!custRows.length && changedVariant.id) {
          const { data: c3 } = await supabase
            .from(customerTable)
            .select("*")
            .eq("product_id", row.id)
            .eq("variant_id", changedVariant.id);
          custRows = c3 || [];
        }

        if (!custRows.length) {
          console.log(
            `[cascade:${customerTable}] no customer rows found for size="${variantSize}"`,
          );
          continue;
        }

        for (const cp of custRows) {
          const additionalUSD =
            sf(cp.export_doc) +
            sf(cp.transport_cost) +
            sf(cp.loading_cost) +
            sf(cp.airway_cost) +
            sf(cp.forwardHandling_cost);
          const fobInUSD =
            changedVariant.exfactoryprice / usdRate + additionalUSD;
          const updateData = {
            purchasing_price: newPP,
            exfactoryprice: changedVariant.exfactoryprice,
            fob_price: parseFloat(fobInUSD.toFixed(4)),
          };

          if (isAir) {
            const { data: customer } = await supabase
              .from("exportcustomersair")
              .select("country, airport_code")
              .eq("cus_id", cp.cus_id)
              .single();
            if (customer) {
              let q = supabase
                .from("freight_rates")
                .select("*")
                .eq("country", customer.country)
                .order("date", { ascending: false })
                .limit(1);
              if (customer.airport_code)
                q = supabase
                  .from("freight_rates")
                  .select("*")
                  .eq("country", customer.country)
                  .eq("airport_code", customer.airport_code)
                  .order("date", { ascending: false })
                  .limit(1);
              const { data: rates } = await q;
              const rate = rates?.[0];
              const m = sf(cp.multiplier, 1);
              const d = sf(cp.divisor, 1) || 1;
              if (rate) {
                const fc45 = (m * sf(rate.rate_45kg)) / d;
                const fc100 = (m * sf(rate.rate_100kg)) / d;
                const fc300 = (m * sf(rate.rate_300kg)) / d;
                const fc500 = (m * sf(rate.rate_500kg)) / d;
                Object.assign(updateData, {
                  freight_cost_45kg: fc45,
                  freight_cost_100kg: fc100,
                  freight_cost_300kg: fc300,
                  freight_cost_500kg: fc500,
                  cnf_45kg: parseFloat((fobInUSD + fc45).toFixed(4)),
                  cnf_100kg: parseFloat((fobInUSD + fc100).toFixed(4)),
                  cnf_300kg: parseFloat((fobInUSD + fc300).toFixed(4)),
                  cnf_500kg: parseFloat((fobInUSD + fc500).toFixed(4)),
                });
              } else {
                Object.assign(updateData, {
                  cnf_45kg: parseFloat(
                    (fobInUSD + sf(cp.freight_cost_45kg)).toFixed(4),
                  ),
                  cnf_100kg: parseFloat(
                    (fobInUSD + sf(cp.freight_cost_100kg)).toFixed(4),
                  ),
                  cnf_300kg: parseFloat(
                    (fobInUSD + sf(cp.freight_cost_300kg)).toFixed(4),
                  ),
                  cnf_500kg: parseFloat(
                    (fobInUSD + sf(cp.freight_cost_500kg)).toFixed(4),
                  ),
                });
              }
            }
          } else {
            Object.assign(updateData, {
              cnf_20ft: parseFloat(
                (fobInUSD + sf(cp.freight_cost_20ft)).toFixed(4),
              ),
              cnf_40ft: parseFloat(
                (fobInUSD + sf(cp.freight_cost_40ft)).toFixed(4),
              ),
            });
          }

          await supabase.from(customerTable).update(updateData).eq("id", cp.id);
          console.log(
            `[cascade:${customerTable}] ✅ updated row ${cp.id} FOB=${fobInUSD.toFixed(4)}`,
          );
        }
      }
    }
  } catch (err) {
    console.error(`[cascadeExportProductPurchasePrice:${table}]`, err.message);
  }
}

export default router;
