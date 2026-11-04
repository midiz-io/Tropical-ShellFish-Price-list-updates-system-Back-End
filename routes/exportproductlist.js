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
    const { data, error } = await supabase
      .from("exportproducts")
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

// GET by id
router.get("/:id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("exportproducts")
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
      .from("exportproducts")
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
      : existing_image_url || req.body.image_url_direct || null;

    const { data: current, error: fetchErr } = await supabase
      .from("exportproducts")
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
      .from("exportproducts")
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

    // ✅ REMOVED: Cascade is now handled by usd-rates.js recalculateCustomerPrices
    // No longer need to call cascade here as it causes double updates with stale data

    const { data: updated } = await supabase
      .from("exportproducts")
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
      .from("exportproducts")
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
      .from("exportproducts")
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
      .from("exportproducts")
      .select("variants")
      .eq("id", productId)
      .single();
    if (fe) throw fe;
    const variants = Array.isArray(prod.variants) ? prod.variants : [];
    const newVar = buildVariant(req.body);
    const { error } = await supabase
      .from("exportproducts")
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
      .from("exportproducts")
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
      .from("exportproducts")
      .update({ variants: updated })
      .eq("id", productId);
    if (error) throw error;

    // ✅ REMOVED: Cascade removed - handled by usd-rates.js
    // await cascadeCustomerPrices(...);

    res.json(updated.find((v) => v.id == variantId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:productId/variants/:variantId", async (req, res) => {
  const { productId, variantId } = req.params;
  try {
    const { data: prod, error: fe } = await supabase
      .from("exportproducts")
      .select("variants")
      .eq("id", productId)
      .single();
    if (fe) throw fe;
    const updated = (prod.variants || []).filter((v) => v.id != variantId);
    const { error } = await supabase
      .from("exportproducts")
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
  const id =
    existing?.id || Date.now() * 1000 + Math.floor(Math.random() * 1000);
  const usdRateVal = sf(body.usdrate, 304);
  const hasPP = sf(body.purchasing_price) > 0;
  const hasJCF = sf(body.jc_fob) > 0;

  let exFactory = 0,
    fobUSD = 0,
    profitMargin = 0;
  if (hasPP) {
    const totalUSD =
      sf(body.labour_overhead) + sf(body.packing_cost) + sf(body.profit);
    exFactory = sf(body.purchasing_price) + totalUSD * usdRateVal;
    fobUSD = usdRateVal > 0 ? exFactory / usdRateVal : 0;
    profitMargin = fobUSD > 0 ? (sf(body.profit) / fobUSD) * 100 : 0;
  } else if (hasJCF) {
    const totalUSD =
      sf(body.jc_fob) +
      sf(body.profit) +
      sf(body.packing_cost) +
      sf(body.labour_overhead);
    exFactory = totalUSD * usdRateVal;
    fobUSD = totalUSD;
    profitMargin = fobUSD > 0 ? (sf(body.profit) / fobUSD) * 100 : 0;
  }

  return {
    id,
    size: body.size || existing?.size || "",
    unit: body.unit || existing?.unit || "kg",
    purchasing_price: hasPP ? sf(body.purchasing_price) : 0,
    jc_fob: hasJCF ? sf(body.jc_fob) : 0,
    usdrate: usdRateVal,
    labour_overhead: sf(body.labour_overhead),
    packing_cost: sf(body.packing_cost),
    profit: sf(body.profit),
    profit_margin: parseFloat(profitMargin.toFixed(4)),
    exfactoryprice: parseFloat(exFactory.toFixed(2)),
    multiplier: sf(body.multiplier),
    divisor: sf(body.divisor, 1),
  };
}

async function updateCustomerImage(epId, newImageUrl) {
  if (!newImageUrl) return;
  try {
    // Match by exportproducts.id (stored as product_id in customer table)
    await supabase
      .from("exportcustomer_product")
      .update({ image_url: newImageUrl })
      .eq("product_id", epId);
  } catch (err) {
    console.error("[updateCustomerImage:sea]", err.message);
  }
}

// Note: cascadeCustomerPrices is kept but NOT called from variant routes
// It is only used by the usd-rates.js recalculateCustomerPrices function
async function cascadeCustomerPrices(
  epId,
  masterProductId,
  variantId,
  size,
  newExFactory,
  newPurchasePrice,
) {
  console.log(
    `[cascade:sea:CALLED] epId=${epId} master=${masterProductId} variant=${variantId} size="${size}" newExf=${newExFactory}`,
  );
  try {
    // Fetch the current product to get the latest variant values
    const { data: currentProduct, error: fetchError } = await supabase
      .from("exportproducts")
      .select("variants")
      .eq("id", epId)
      .single();

    if (fetchError) {
      console.error(
        `[cascade] Failed to fetch product ${epId}:`,
        fetchError.message,
      );
      return;
    }

    // Find the matching variant
    let latestVariant = null;
    if (currentProduct?.variants) {
      if (variantId) {
        latestVariant = currentProduct.variants.find(
          (v) => String(v.id) === String(variantId),
        );
      }
      if (!latestVariant && size) {
        latestVariant = currentProduct.variants.find((v) => v.size === size);
      }
    }

    // Use latest values from database
    const latestExFactory = latestVariant
      ? sf(latestVariant.exfactoryprice)
      : sf(newExFactory);
    const latestPurchasePrice = latestVariant
      ? sf(latestVariant.purchasing_price)
      : sf(newPurchasePrice);
    const latestSize = latestVariant?.size || size;

    if (latestVariant) {
      console.log(
        `[cascade] Retrieved latest values: exf=${latestExFactory} (was passed ${newExFactory}), pp=${latestPurchasePrice} (was passed ${newPurchasePrice})`,
      );
    }

    // Check if customer prices already have this exfactoryprice
    const { data: existingCustomerPrice } = await supabase
      .from("exportcustomer_product")
      .select("exfactoryprice")
      .eq("product_id", masterProductId)
      .eq("size_range", latestSize)
      .maybeSingle();

    if (
      existingCustomerPrice &&
      Math.abs(sf(existingCustomerPrice.exfactoryprice) - latestExFactory) <
        0.01
    ) {
      console.log(
        `[cascade] ⏭️ SKIP - Customer price already has correct exf=${latestExFactory} for size="${latestSize}"`,
      );
      return;
    }

    const { data: usdRow } = await supabase
      .from("usd_rates")
      .select("rate")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();
    const usdRate = sf(usdRow?.rate, 304);

    // Match customer rows
    const rowMap = {};
    const addRows = (rows) => {
      for (const r of rows || []) rowMap[r.id] = r;
    };

    if (latestSize) {
      if (masterProductId) {
        const { data: r1 } = await supabase
          .from("exportcustomer_product")
          .select("*")
          .eq("product_id", masterProductId)
          .eq("size_range", latestSize);
        addRows(r1);
      }
      if (epId !== masterProductId) {
        const { data: r2 } = await supabase
          .from("exportcustomer_product")
          .select("*")
          .eq("product_id", epId)
          .eq("size_range", latestSize);
        addRows(r2);
      }
    }

    if (variantId && masterProductId) {
      const { data: r3 } = await supabase
        .from("exportcustomer_product")
        .select("*")
        .eq("product_id", masterProductId)
        .eq("variant_id", variantId);
      addRows(r3);
    }

    const rows = Object.values(rowMap);
    if (!rows.length) {
      console.log(
        `[cascade:sea] no rows matched for ep=${epId} master=${masterProductId} size="${latestSize}"`,
      );
      return;
    }

    for (const cp of rows) {
      const handlingUSD =
        sf(cp.export_doc) +
        sf(cp.transport_cost) +
        sf(cp.loading_cost) +
        sf(cp.airway_cost) +
        sf(cp.forwardHandling_cost);
      const fobInUSD = latestExFactory / usdRate + handlingUSD;
      const fc20 = sf(cp.freight_cost_20ft);
      const fc40 = sf(cp.freight_cost_40ft);
      const fc45 = sf(cp.freight_cost_45kg);
      const fc100 = sf(cp.freight_cost_100kg);
      const fc300 = sf(cp.freight_cost_300kg);
      const fc500 = sf(cp.freight_cost_500kg);

      const updateData = {
        purchasing_price: latestPurchasePrice,
        exfactoryprice: parseFloat(latestExFactory.toFixed(2)),
        fob_price: parseFloat(fobInUSD.toFixed(4)),
        cnf_20ft: parseFloat((fobInUSD + fc20).toFixed(4)),
        cnf_40ft: parseFloat((fobInUSD + fc40).toFixed(4)),
        cnf_45kg: parseFloat((fobInUSD + fc45).toFixed(4)),
        cnf_100kg: parseFloat((fobInUSD + fc100).toFixed(4)),
        cnf_300kg: parseFloat((fobInUSD + fc300).toFixed(4)),
        cnf_500kg: parseFloat((fobInUSD + fc500).toFixed(4)),
      };

      await supabase
        .from("exportcustomer_product")
        .update(updateData)
        .eq("id", cp.id);
      console.log(
        `[cascade:sea] ✅ updated row ${cp.id} size="${cp.size_range}" FOB=$${fobInUSD.toFixed(4)} (exf=${latestExFactory}, rate=${usdRate})`,
      );
    }
  } catch (err) {
    console.error("[cascadeCustomerPrices:sea]", err.message);
  }
}

export default router;
