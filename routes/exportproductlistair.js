import express from "express";
import supabase from "../db.js";
import multer from "multer";
import { extname } from "path";

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage });
const sf = (v, d = 0) => (isFinite(parseFloat(v)) ? parseFloat(v) : d);

async function uploadImage(file) {
  const fileName = `${Date.now()}${extname(file.originalname)}`;
  const { error } = await supabase.storage
    .from("product-images")
    .upload(fileName, file.buffer, { contentType: file.mimetype });
  if (error) throw error;
  const {
    data: { publicUrl },
  } = supabase.storage.from("product-images").getPublicUrl(fileName);
  return publicUrl;
}

// GET all
router.get("/", async (req, res) => {
  try {
    const { data: products, error } = await supabase
      .from("exportproductsair")
      .select("*")
      .order("common_name");
    if (error) throw error;
    const result = (products || []).map((p) => ({
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
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET by id
router.get("/:id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("exportproductsair")
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

// POST /upload
router.post("/upload", upload.single("image"), async (req, res) => {
  try {
    const {
      common_name,
      scientific_name,
      description,
      category,
      species_type,
      variants,
      product_id,
    } = req.body;
    const image_url = req.file
      ? await uploadImage(req.file)
      : req.body.image_url_direct || null;
    let variantsData = [];
    try {
      variantsData =
        typeof variants === "string" ? JSON.parse(variants) : variants || [];
      if (!Array.isArray(variantsData)) variantsData = [];
    } catch {
      variantsData = [];
    }
    const { data, error } = await supabase
      .from("exportproductsair")
      .insert({
        common_name,
        scientific_name,
        description,
        category,
        species_type,
        image_url: image_url || null,
        variants: variantsData,
        product_id: product_id ? parseInt(product_id) : null,
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

// PUT /upload/:id
router.put("/upload/:id", upload.single("image"), async (req, res) => {
  try {
    const {
      common_name,
      scientific_name,
      description,
      category,
      species_type,
      existing_image_url,
      variants,
      product_id,
    } = req.body;
    const image_url = req.file
      ? await uploadImage(req.file)
      : existing_image_url || null;

    const { data: current, error: fetchErr } = await supabase
      .from("exportproductsair")
      .select("variants, image_url, product_id")
      .eq("id", req.params.id)
      .single();
    if (fetchErr) throw fetchErr;

    let variantsData = [];
    try {
      variantsData =
        typeof variants === "string" ? JSON.parse(variants) : variants || [];
      if (!Array.isArray(variantsData)) variantsData = [];
    } catch {
      variantsData = [];
    }

    const parsedProductId = product_id ? parseInt(product_id) : null;
    const shouldSetProductId =
      parsedProductId && parsedProductId !== parseInt(req.params.id);

    const { error: updateErr } = await supabase
      .from("exportproductsair")
      .update({
        common_name,
        scientific_name,
        description,
        category,
        species_type,
        image_url: image_url || null,
        variants: variantsData,
        ...(shouldSetProductId ? { product_id: parsedProductId } : {}),
      })
      .eq("id", req.params.id);
    if (updateErr) throw updateErr;

    if (image_url && current.image_url !== image_url) {
      await updateCustomerImage(req.params.id, image_url);
    }

    // ✅ REMOVED: Cascade is now handled by productlist.js cascadeExportProductPurchasePrice
    // When master catalogue purchasing_price changes, it cascades to this table
    // No need to call cascade here as it causes double updates with stale data

    const { data: updated } = await supabase
      .from("exportproductsair")
      .select("*")
      .eq("id", req.params.id)
      .single();
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE
router.delete("/:id", async (req, res) => {
  try {
    const { error } = await supabase
      .from("exportproductsair")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ message: "Product deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Variant routes
router.get("/:productId/variants", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("exportproductsair")
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
      .from("exportproductsair")
      .select("variants")
      .eq("id", productId)
      .single();
    if (fe) throw fe;
    const variants = Array.isArray(prod.variants) ? prod.variants : [];
    const newVar = buildVariant(req.body);
    const { error } = await supabase
      .from("exportproductsair")
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
      .from("exportproductsair")
      .select("variants, product_id")
      .eq("id", productId)
      .single();
    if (fe) throw fe;
    const variants = Array.isArray(prod.variants) ? prod.variants : [];
    const old = variants.find((v) => v.id == variantId);
    const newVar = buildVariant(req.body, old);
    const updated = variants.map((v) =>
      v.id == variantId ? { ...old, ...newVar } : v,
    );
    const { error } = await supabase
      .from("exportproductsair")
      .update({ variants: updated })
      .eq("id", productId);
    if (error) throw error;

    // ✅ REMOVED: Cascade removed - handled by productlist.js when master purchasing_price changes
    // Manual edits to export variants don't cascade to customer prices
    // Customer prices are updated when master catalogue changes or USD rate changes

    res.json(updated.find((v) => v.id == variantId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:productId/variants/:variantId", async (req, res) => {
  const { productId, variantId } = req.params;
  try {
    const { data: prod, error: fe } = await supabase
      .from("exportproductsair")
      .select("variants")
      .eq("id", productId)
      .single();
    if (fe) throw fe;
    const updated = (prod.variants || []).filter((v) => v.id != variantId);
    const { error } = await supabase
      .from("exportproductsair")
      .update({ variants: updated })
      .eq("id", productId);
    if (error) throw error;
    res.json({ message: "Variant deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Helpers ──────────────────────────────────────────────────────
function buildVariant(body, existing = null) {
  const id = existing?.id || Date.now();
  const usdRateVal = sf(body.usdrate, 304);
  const hasPP = sf(body.purchasing_price) > 0;
  const hasJCF = sf(body.jc_fob) > 0;
  // Use profit_usd for air variants (stored as profit_usd, not profit)
  const profitUSD = sf(body.profit_usd);
  const labour = sf(body.labour_overhead);
  const packing = sf(body.packing_cost);

  let exFactory = 0,
    fobUSD = 0,
    profitMargin = 0;
  if (hasPP) {
    exFactory =
      sf(body.purchasing_price) + (labour + packing + profitUSD) * usdRateVal;
    fobUSD = usdRateVal > 0 ? exFactory / usdRateVal : 0;
    profitMargin = fobUSD > 0 ? (profitUSD / fobUSD) * 100 : 0;
  } else if (hasJCF) {
    const total = sf(body.jc_fob) + profitUSD + packing + labour;
    exFactory = total * usdRateVal;
    fobUSD = total;
    profitMargin = fobUSD > 0 ? (profitUSD / fobUSD) * 100 : 0;
  }

  return {
    id,
    size: body.size || existing?.size || "",
    unit: body.unit || existing?.unit || "kg",
    purchasing_price: hasPP ? sf(body.purchasing_price) : 0,
    jc_fob: hasJCF ? sf(body.jc_fob) : 0,
    usdrate: usdRateVal,
    labour_overhead: labour,
    packing_cost: packing,
    profit_usd: profitUSD,
    profit_lkr: sf(body.profit_lkr),
    profit_currency: body.profit_currency || "usd",
    profit_margin: parseFloat(profitMargin.toFixed(4)),
    exfactoryprice: parseFloat(exFactory.toFixed(2)),
    multiplier: sf(body.multiplier),
    divisor: sf(body.divisor, 1),
  };
}

async function updateCustomerImage(productId, newImageUrl) {
  if (!newImageUrl) return;
  try {
    await supabase
      .from("exportcustomer_productair")
      .update({ image_url: newImageUrl })
      .eq("product_id", productId);
  } catch (err) {
    console.error("[updateCustomerImage:air]", err.message);
  }
}

// Note: cascadeCustomerPrices is kept but NOT called from variant routes
// It is only used by the productlist.js cascadeExportProductPurchasePrice function
async function cascadeCustomerPrices(
  epId,
  masterProductId,
  variantId,
  size,
  newExFactory,
  newPurchasePrice,
) {
  console.log(
    `[cascade:air:CALLED] epId=${epId} master=${masterProductId} size="${size}" newExf=${newExFactory}`,
  );
  try {
    const { data: usdRow } = await supabase
      .from("usd_rates")
      .select("rate")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();
    const usdRate = sf(usdRow?.rate, 304);

    const rowMap = {};
    const addRows = (rows) => {
      for (const r of rows || []) rowMap[r.id] = r;
    };

    if (size) {
      const { data: r1 } = await supabase
        .from("exportcustomer_productair")
        .select("*")
        .eq("product_id", epId)
        .eq("size_range", size);
      addRows(r1);
      if (masterProductId && masterProductId !== epId) {
        const { data: r2 } = await supabase
          .from("exportcustomer_productair")
          .select("*")
          .eq("product_id", masterProductId)
          .eq("size_range", size);
        addRows(r2);
      }
    }
    if (variantId) {
      const { data: r3 } = await supabase
        .from("exportcustomer_productair")
        .select("*")
        .eq("product_id", epId)
        .eq("variant_id", variantId);
      addRows(r3);
    }

    const rows = Object.values(rowMap);
    if (!rows.length) {
      console.log(
        `[cascade:air] no rows matched for ep=${epId} size="${size}"`,
      );
      return;
    }

    for (const cp of rows) {
      const additionalUSD =
        sf(cp.export_doc) +
        sf(cp.transport_cost) +
        sf(cp.loading_cost) +
        sf(cp.airway_cost) +
        sf(cp.forwardHandling_cost);
      const fobInUSD = newExFactory / usdRate + additionalUSD;

      const updateData = {
        purchasing_price: newPurchasePrice,
        exfactoryprice: parseFloat(newExFactory.toFixed(2)),
        fob_price: parseFloat(fobInUSD.toFixed(4)),
        cnf_45kg: parseFloat((fobInUSD + sf(cp.freight_cost_45kg)).toFixed(4)),
        cnf_100kg: parseFloat(
          (fobInUSD + sf(cp.freight_cost_100kg)).toFixed(4),
        ),
        cnf_300kg: parseFloat(
          (fobInUSD + sf(cp.freight_cost_300kg)).toFixed(4),
        ),
        cnf_500kg: parseFloat(
          (fobInUSD + sf(cp.freight_cost_500kg)).toFixed(4),
        ),
      };

      await supabase
        .from("exportcustomer_productair")
        .update(updateData)
        .eq("id", cp.id);
      console.log(
        `[cascade:air] ✅ updated row ${cp.id} size="${cp.size_range}" exf=${newExFactory} FOB=$${fobInUSD.toFixed(4)}`,
      );
    }
  } catch (err) {
    console.error("[cascadeCustomerPrices:air]", err.message);
  }
}

export default router;
