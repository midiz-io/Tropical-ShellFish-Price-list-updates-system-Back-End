import express from "express";
import supabase from "../db.js";

const router = express.Router();

const recalculateSeaFreightProducts = async (
  country,
  portCode,
  newRateData,
) => {
  try {
    console.log(`\n=== Starting Sea Freight Recalculation ===`);
    console.log(`Country: ${country}, Port: ${portCode}`);

    // Get current USD rate
    const { data: usdRateData, error: usdError } = await supabase
      .from("usd_rates")
      .select("rate")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();

    if (usdError || !usdRateData) {
      console.error("Could not fetch USD rate:", usdError);
      return { updated: 0, errors: 0 };
    }

    const currentUsdRate = parseFloat(usdRateData.rate);
    console.log(`USD Rate: ${currentUsdRate}`);

    // Find matching customers
    const { data: allCustomers, error: custError } = await supabase
      .from("exportcustomers")
      .select("cus_id, cus_name, country, port_code");

    if (custError) {
      console.error("Error fetching customers:", custError);
      return { updated: 0, errors: 0 };
    }

    const customers = allCustomers.filter(
      (c) =>
        c.country &&
        c.port_code &&
        c.country.toLowerCase().trim() === country.toLowerCase().trim() &&
        c.port_code.toUpperCase().trim() === portCode.toUpperCase().trim(),
    );

    console.log(`Matching customers: ${customers.length}`);

    if (customers.length === 0) {
      return { updated: 0, errors: 0 };
    }

    const customerIds = customers.map((c) => c.cus_id);

    // Get sea freight products for these customers
    const { data: products, error: fetchError } = await supabase
      .from("exportcustomer_product")
      .select("*")
      .in("cus_id", customerIds)
      .eq("freight_type", "sea");

    if (fetchError) throw fetchError;

    console.log(`Sea freight products found: ${products?.length || 0}`);

    if (!products || products.length === 0) {
      return { updated: 0, errors: 0 };
    }

    const freightPerKilo20ft =
      parseFloat(newRateData.freight_per_kilo_20ft) || 0;
    const freightPerKilo40ft =
      parseFloat(newRateData.freight_per_kilo_40ft) || 0;

    let updated = 0;
    let errors = 0;

    for (const product of products) {
      try {
        const fobPrice = parseFloat(product.fob_price) || 0;

        // Same formula as frontend calculateBothSeaContainers:
        // freight_cost = freight_per_kilo (direct, no multiplier/divisor)
        // cnf = (fob_price_lkr / usd_rate) + freight_per_kilo
        const fobInUSD = fobPrice / currentUsdRate;
        const cnf20ft = fobInUSD + freightPerKilo20ft;
        const cnf40ft = fobInUSD + freightPerKilo40ft;

        console.log(`Product ${product.id} (${product.common_name}):`);
        console.log(`  FOB: Rs.${fobPrice} → $${fobInUSD.toFixed(4)}`);
        console.log(
          `  20ft → freight: $${freightPerKilo20ft}, CNF: $${cnf20ft.toFixed(2)}`,
        );
        console.log(
          `  40ft → freight: $${freightPerKilo40ft}, CNF: $${cnf40ft.toFixed(2)}`,
        );

        const { error: updateError } = await supabase
          .from("exportcustomer_product")
          .update({
            freight_cost_20ft: parseFloat(freightPerKilo20ft.toFixed(4)),
            freight_cost_40ft: parseFloat(freightPerKilo40ft.toFixed(4)),
            cnf_20ft: parseFloat(cnf20ft.toFixed(2)),
            cnf_40ft: parseFloat(cnf40ft.toFixed(2)),
          })
          .eq("id", product.id);

        if (updateError) {
          console.error(`  ❌ Error:`, updateError);
          errors++;
        } else {
          console.log(`  ✅ Updated`);
          updated++;
        }
      } catch (err) {
        console.error(`  ❌ Error processing product ${product.id}:`, err);
        errors++;
      }
    }

    console.log(`\n=== Complete: ${updated} updated, ${errors} errors ===\n`);
    return { updated, errors };
  } catch (err) {
    console.error("Error in recalculateSeaFreightProducts:", err);
    throw err;
  }
};

// GET all sea freight rates
router.get("/", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("sea_freight_rates")
      .select("*")
      .order("date", { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET latest rate by country and port
router.get("/latest/:country/:portCode", async (req, res) => {
  try {
    const { country, portCode } = req.params;
    const { data, error } = await supabase
      .from("sea_freight_rates")
      .select("*")
      .eq("country", country)
      .eq("port_code", portCode)
      .order("date", { ascending: false })
      .limit(1)
      .single();

    if (error) {
      if (error.code === "PGRST116")
        return res.status(404).json({ message: "No rate found" });
      throw error;
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST - Add new sea freight rate
router.post("/", async (req, res) => {
  try {
    const payload = req.body;
    const { data, error } = await supabase
      .from("sea_freight_rates")
      .insert({ ...payload, updated_at: new Date().toISOString() })
      .select()
      .single();

    if (error) throw error;

    const recalcResult = await recalculateSeaFreightProducts(
      payload.country,
      payload.port_code,
      {
        freight_per_kilo_20ft: payload.freight_per_kilo_20ft,
        freight_per_kilo_40ft: payload.freight_per_kilo_40ft,
      },
    );

    res.status(201).json({
      ...data,
      recalculation: {
        productsUpdated: recalcResult.updated,
        errors: recalcResult.errors,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT - Update existing sea freight rate
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const payload = req.body;

    const { data, error } = await supabase
      .from("sea_freight_rates")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    const recalcResult = await recalculateSeaFreightProducts(
      payload.country,
      payload.port_code,
      {
        freight_per_kilo_20ft: payload.freight_per_kilo_20ft,
        freight_per_kilo_40ft: payload.freight_per_kilo_40ft,
      },
    );

    res.json({
      ...data,
      recalculation: {
        productsUpdated: recalcResult.updated,
        errors: recalcResult.errors,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE - Delete sea freight rate
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from("sea_freight_rates")
      .delete()
      .eq("id", id);
    if (error) throw error;
    res.json({ message: "Sea freight rate deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST - Manual recalculation for a specific country + port
router.post("/recalculate", async (req, res) => {
  try {
    const { country, port_code } = req.body;
    if (!country || !port_code) {
      return res
        .status(400)
        .json({ message: "country and port_code are required" });
    }

    const { data: latestRate, error: rateError } = await supabase
      .from("sea_freight_rates")
      .select("*")
      .eq("country", country)
      .eq("port_code", port_code)
      .order("date", { ascending: false })
      .limit(1)
      .single();

    if (rateError || !latestRate) {
      return res.status(404).json({ message: "No sea freight rate found" });
    }

    const recalcResult = await recalculateSeaFreightProducts(
      country,
      port_code,
      {
        freight_per_kilo_20ft: latestRate.freight_per_kilo_20ft,
        freight_per_kilo_40ft: latestRate.freight_per_kilo_40ft,
      },
    );

    res.json({
      message: "Recalculated successfully",
      recalculation: recalcResult,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
