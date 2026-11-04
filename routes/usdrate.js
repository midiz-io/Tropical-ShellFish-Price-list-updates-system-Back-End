import express from "express";
import supabase from "../db.js";

const router = express.Router();
const sf = (v, d = 0) => (isFinite(parseFloat(v)) ? parseFloat(v) : d);

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1: Recalculate exportproducts + exportproductsair variants
// ─────────────────────────────────────────────────────────────────────────────
const updateExportProductVariants = async (newRate) => {
  console.log(`[USD] Updating export product variants to rate: ${newRate}`);
  let updated = 0,
    errors = 0;

  for (const table of ["exportproducts", "exportproductsair"]) {
    const isAir = table === "exportproductsair";
    const { data: products, error } = await supabase
      .from(table)
      .select("id, variants");
    if (error) {
      console.error(`[USD:${table}] fetch error:`, error.message);
      continue;
    }

    for (const product of products || []) {
      if (!Array.isArray(product.variants) || !product.variants.length)
        continue;
      try {
        const updatedVariants = product.variants.map((v) => {
          const pp = sf(v.purchasing_price),
            jcFob = sf(v.jc_fob);
          const labour = sf(v.labour_overhead),
            packing = sf(v.packing_cost);
          // Use v.profit directly — profit_usd is not stored in sea variants
          const profitUSD = isAir ? sf(v.profit_usd) : sf(v.profit);
          let newExFactory = sf(v.exfactoryprice);
          if (jcFob > 0) {
            newExFactory = parseFloat(
              ((jcFob + profitUSD + packing + labour) * newRate).toFixed(2),
            );
          } else if (pp > 0) {
            newExFactory = parseFloat(
              (pp + (labour + packing + profitUSD) * newRate).toFixed(2),
            );
          }
          console.log(
            `[USD:variant] "${v.size}": pp=${pp} packing=${packing} profit=${profitUSD} rate=${newRate} → exf=${newExFactory} (was ${sf(v.exfactoryprice)})`,
          );
          return {
            ...v,
            usdrate: newRate,
            exfactoryprice: newExFactory,
            profit_lkr:
              profitUSD > 0
                ? parseFloat((profitUSD * newRate).toFixed(2))
                : sf(v.profit_lkr),
          };
        });
        const { error: upErr } = await supabase
          .from(table)
          .update({ variants: updatedVariants })
          .eq("id", product.id);
        if (upErr) {
          console.error(
            `[USD:${table}] update error ${product.id}:`,
            upErr.message,
          );
          errors++;
        } else updated++;
      } catch (e) {
        console.error(`[USD:${table}] exception ${product.id}:`, e.message);
        errors++;
      }
    }
    console.log(`[USD:${table}] ✅ ${updated} updated`);
    updated = 0;
  }
  return { updated, errors };
};

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2: Recalculate customer prices using fresh exfactoryprice
// Uses size_range as primary match key (most reliable given null variant_ids)
// ─────────────────────────────────────────────────────────────────────────────
const recalculateCustomerPrices = async (newRate) => {
  console.log(`[USD] Recalculating customer prices with rate: ${newRate}`);
  const results = {
    sea: { updated: 0, errors: 0 },
    air: { updated: 0, errors: 0 },
  };

  // Build lookup keyed by BOTH ep.id AND ep.product_id (master id)
  // exportcustomer_product.product_id may contain either one depending on how inserted
  const exfBySize = {}; // key: `${id}:${size}` → freshly recalculated exfactoryprice

  for (const epTable of ["exportproducts", "exportproductsair"]) {
    const { data: epRows, error } = await supabase
      .from(epTable)
      .select("id, product_id, variants");
    if (error) {
      console.error(`[USD:exfLookup:${epTable}]`, error.message);
      continue;
    }
    for (const ep of epRows || []) {
      for (const v of ep.variants || []) {
        const exf = sf(v.exfactoryprice);
        const size = String(v.size || "");
        // Key by ep.id (customer rows often store exportproducts.id as product_id)
        exfBySize[`${ep.id}:${size}`] = exf;
        // Also key by master product_id (for rows correctly using FK)
        if (ep.product_id) exfBySize[`${ep.product_id}:${size}`] = exf;
      }
    }
  }
  console.log(`[USD] exfBySize built: ${Object.keys(exfBySize).length} keys`);

  const tables = [
    { name: "exportcustomer_product", key: "sea" },
    { name: "exportcustomer_productair", key: "air" },
  ];

  for (const { name, key } of tables) {
    const { data: rows, error } = await supabase.from(name).select("*");
    if (error) {
      console.error(`[USD:${name}] fetch error:`, error.message);
      continue;
    }

    for (const cp of rows || []) {
      try {
        const size = String(cp.size_range || "");
        const vid = String(cp.variant_id || "");

        // Match by product_id + size_range (keyed by both ep.id and ep.product_id)
        const freshExf = exfBySize[`${cp.product_id}:${size}`];

        const exf = freshExf !== undefined ? freshExf : sf(cp.exfactoryprice);

        if (freshExf !== undefined) {
          console.log(
            `[USD] ✅ matched ${cp.common_name} "${size}": exf=${exf}`,
          );
        } else {
          console.warn(
            `[USD] ⚠️ NO MATCH for product_id=${cp.product_id} size="${size}" — keeping existing exf=${exf}`,
          );
        }

        const handlingUSD =
          sf(cp.export_doc) +
          sf(cp.transport_cost) +
          sf(cp.loading_cost) +
          sf(cp.airway_cost) +
          sf(cp.forwardHandling_cost);
        const fobUSD = exf / newRate + handlingUSD;

        const updates = {
          exfactoryprice: parseFloat(exf.toFixed(2)),
          fob_price: parseFloat(fobUSD.toFixed(4)),
        };

        const fType = cp.freight_type || key;
        if (fType === "sea") {
          updates.cnf_20ft = parseFloat(
            (fobUSD + sf(cp.freight_cost_20ft)).toFixed(4),
          );
          updates.cnf_40ft = parseFloat(
            (fobUSD + sf(cp.freight_cost_40ft)).toFixed(4),
          );
        } else {
          updates.cnf_45kg = parseFloat(
            (fobUSD + sf(cp.freight_cost_45kg)).toFixed(4),
          );
          updates.cnf_100kg = parseFloat(
            (fobUSD + sf(cp.freight_cost_100kg)).toFixed(4),
          );
          updates.cnf_300kg = parseFloat(
            (fobUSD + sf(cp.freight_cost_300kg)).toFixed(4),
          );
          updates.cnf_500kg = parseFloat(
            (fobUSD + sf(cp.freight_cost_500kg)).toFixed(4),
          );
        }

        const { data: upData, error: upErr } = await supabase
          .from(name)
          .update(updates)
          .eq("id", cp.id)
          .select();
        if (upErr) {
          results[key].errors++;
          console.error(`[USD:${name}] row ${cp.id} ERROR:`, upErr.message);
        } else {
          results[key].updated++;
          console.log(
            `[USD:${name}] row ${cp.id} → saved exf=${upData?.[0]?.exfactoryprice} fob=${upData?.[0]?.fob_price}`,
          );
        }
      } catch (e) {
        results[key].errors++;
        console.error(`[USD:${name}] exception ${cp.id}:`, e.message);
      }
    }
    console.log(
      `[USD:${name}] ✅ ${results[key].updated} updated, ${results[key].errors} errors`,
    );
  }
  return results;
};

// ─────────────────────────────────────────────────────────────────────────────
// Combined trigger — sequential
// ─────────────────────────────────────────────────────────────────────────────
const onRateChanged = async (newRate) => {
  console.log(`\n[USD Rate Change] New rate: ${newRate}`);
  let variantUpdates;
  try {
    variantUpdates = await updateExportProductVariants(newRate);
    console.log("[USD] ✅ Variants updated — recalculating customer prices");
  } catch (e) {
    variantUpdates = { error: e.message };
  }

  let customerPriceUpdates;
  try {
    customerPriceUpdates = await recalculateCustomerPrices(newRate);
  } catch (e) {
    customerPriceUpdates = { error: e.message };
  }

  return { variantUpdates, customerPriceUpdates };
};

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

router.get("/", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("usd_rates")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();
    if (error)
      return res
        .status(error.code === "PGRST116" ? 404 : 500)
        .json({ message: error.message });
    res.json({ rate: data.rate, date: data.date, updated_at: data.updated_at });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get("/history", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 30;
    const { data, error } = await supabase
      .from("usd_rates")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get("/date/:date", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("usd_rates")
      .select("*")
      .eq("date", req.params.date)
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();
    if (error)
      return res
        .status(error.code === "PGRST116" ? 404 : 500)
        .json({ message: error.message });
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { rate, date } = req.body;
    if (!rate || sf(rate) <= 0)
      return res.status(400).json({ message: "Valid rate required" });
    const newRate = sf(rate);
    const { data: saved, error } = await supabase
      .from("usd_rates")
      .insert({
        rate: newRate,
        date: date || new Date().toISOString().split("T")[0],
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw error;
    const recalc = await onRateChanged(newRate);
    res.status(201).json({
      message: "USD rate saved — all prices recalculated",
      rate: saved.rate,
      date: saved.date,
      updated_at: saved.updated_at,
      recalculation: recalc,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const { rate, date } = req.body;
    if (!rate || sf(rate) <= 0)
      return res.status(400).json({ message: "Valid rate required" });
    const newRate = sf(rate);
    const { data: updated, error } = await supabase
      .from("usd_rates")
      .update({ rate: newRate, date, updated_at: new Date().toISOString() })
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    const { data: latest } = await supabase
      .from("usd_rates")
      .select("id")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();
    let recalc = { skipped: true, reason: "Not the latest rate" };
    if (latest && String(latest.id) === String(req.params.id))
      recalc = await onRateChanged(newRate);
    res.json({
      message: recalc.skipped
        ? "Rate updated (not latest)"
        : "Rate updated — all prices recalculated",
      rate: updated.rate,
      date: updated.date,
      recalculation: recalc,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const { error } = await supabase
      .from("usd_rates")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ message: "Rate deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/recalculate", async (req, res) => {
  try {
    const { data: latest, error } = await supabase
      .from("usd_rates")
      .select("rate")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();
    if (error || !latest)
      return res.status(404).json({ message: "No USD rate found" });
    const result = await onRateChanged(sf(latest.rate));
    res.json({
      message: "Manual recalculation complete",
      rateUsed: latest.rate,
      ...result,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

export default router;
