import express from "express";
import supabase from "../db.js";

const router = express.Router();

// Helper function to get the applicable air freight rate by tier
const getAirFreightRateByTier = (tier, rateData) => {
  if (!rateData || !tier) return 0;
  switch (tier) {
    case "gross+45kg":
      return parseFloat(rateData.rate_45kg);
    case "gross+100kg":
      return parseFloat(rateData.rate_100kg);
    case "gross+300kg":
      return parseFloat(rateData.rate_300kg);
    case "gross+500kg":
      return parseFloat(rateData.rate_500kg);
    default:
      return 0;
  }
};

// Helper function to recalculate products affected by air freight rate change
const recalculateAirFreightProducts = async (
  country,
  airportCode,
  newRateData,
) => {
  try {
    console.log(`\n=== Starting Air Freight Recalculation ===`);
    console.log(`Country: ${country}, Airport: ${airportCode}`);
    console.log(`New Rates:`, newRateData);

    // Get current USD rate
    const { data: usdRateData, error: usdError } = await supabase
      .from("usd_rates")
      .select("rate")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();

    if (usdError || !usdRateData) {
      console.error("Could not fetch USD rate:", usdError);
      return { updated: 0, errors: 0, message: "USD rate not found" };
    }

    const currentUsdRate = parseFloat(usdRateData.rate);
    console.log(`Current USD Rate: ${currentUsdRate}`);

    // Find matching customers (case-insensitive)
    const { data: allCustomers, error: custError } = await supabase
      .from("exportcustomersair")
      .select("cus_id, country, airport_code, cus_name");

    if (custError) {
      console.error("Error fetching customers:", custError);
      return { updated: 0, errors: 0, message: "Error fetching customers" };
    }

    const customers = allCustomers.filter(
      (c) =>
        c.country?.toLowerCase().trim() === country.toLowerCase().trim() &&
        c.airport_code?.toUpperCase().trim() ===
          airportCode.toUpperCase().trim(),
    );

    console.log(`Matching customers: ${customers.length}`);
    if (customers.length === 0) {
      return { updated: 0, errors: 0, message: "No matching customers found" };
    }

    const customerIds = customers.map((c) => c.cus_id);

    // Get all air freight products for these customers
    const { data: products, error: fetchError } = await supabase
      .from("exportcustomer_productair")
      .select("*")
      .in("cus_id", customerIds)
      .eq("freight_type", "air");

    if (fetchError) {
      console.error("Error fetching products:", fetchError);
      throw fetchError;
    }

    console.log(`Air freight products to update: ${products?.length || 0}`);

    if (!products || products.length === 0) {
      return {
        updated: 0,
        errors: 0,
        message: "No air freight products found",
      };
    }

    let updated = 0;
    let errors = 0;

    for (const product of products) {
      try {
        const multiplier = parseFloat(product.multiplier) || 0;
        const divisor = parseFloat(product.divisor) || 1;

        if (multiplier === 0) {
          console.log(`  ⚠️ Skipping product ${product.id} — multiplier is 0`);
          continue;
        }

        console.log(
          `\nProcessing product ID ${product.id} (${product.common_name}):`,
        );
        console.log(`  multiplier=${multiplier}, divisor=${divisor}`);

        // Recalculate all 4 freight cost tiers
        const freight_cost_45kg =
          (multiplier * parseFloat(newRateData.rate_45kg)) / divisor;
        const freight_cost_100kg =
          (multiplier * parseFloat(newRateData.rate_100kg)) / divisor;
        const freight_cost_300kg =
          (multiplier * parseFloat(newRateData.rate_300kg)) / divisor;
        const freight_cost_500kg =
          (multiplier * parseFloat(newRateData.rate_500kg)) / divisor;

        // Recalculate FOB in LKR
        const exfactoryprice = parseFloat(product.exfactoryprice) || 0;
        const export_doc = parseFloat(product.export_doc) || 0;
        const transport_cost = parseFloat(product.transport_cost) || 0;
        const loading_cost = parseFloat(product.loading_cost) || 0;
        const airway_cost = parseFloat(product.airway_cost) || 0;
        const forwardHandling = parseFloat(product.forwardHandling_cost) || 0;

        const totalCostsUSD =
          export_doc +
          transport_cost +
          loading_cost +
          airway_cost +
          forwardHandling;
        const fobLKR = exfactoryprice + totalCostsUSD * currentUsdRate;
        const fobUSD = fobLKR / currentUsdRate;

        // Recalculate all 4 CNF tiers
        const cnf_45kg = fobUSD + freight_cost_45kg;
        const cnf_100kg = fobUSD + freight_cost_100kg;
        const cnf_300kg = fobUSD + freight_cost_300kg;
        const cnf_500kg = fobUSD + freight_cost_500kg;

        console.log(
          `  FOB LKR: ${fobLKR.toFixed(2)}, FOB USD: ${fobUSD.toFixed(2)}`,
        );
        console.log(
          `  Freight: 45kg=$${freight_cost_45kg.toFixed(2)}, 100kg=$${freight_cost_100kg.toFixed(2)}, 300kg=$${freight_cost_300kg.toFixed(2)}, 500kg=$${freight_cost_500kg.toFixed(2)}`,
        );
        console.log(
          `  CNF:     45kg=$${cnf_45kg.toFixed(2)}, 100kg=$${cnf_100kg.toFixed(2)}, 300kg=$${cnf_300kg.toFixed(2)}, 500kg=$${cnf_500kg.toFixed(2)}`,
        );

        const { error: updateError } = await supabase
          .from("exportcustomer_productair")
          .update({
            fob_price: parseFloat(fobLKR.toFixed(2)),
            freight_cost_45kg: parseFloat(freight_cost_45kg.toFixed(2)),
            freight_cost_100kg: parseFloat(freight_cost_100kg.toFixed(2)),
            freight_cost_300kg: parseFloat(freight_cost_300kg.toFixed(2)),
            freight_cost_500kg: parseFloat(freight_cost_500kg.toFixed(2)),
            cnf_45kg: parseFloat(cnf_45kg.toFixed(2)),
            cnf_100kg: parseFloat(cnf_100kg.toFixed(2)),
            cnf_300kg: parseFloat(cnf_300kg.toFixed(2)),
            cnf_500kg: parseFloat(cnf_500kg.toFixed(2)),
          })
          .eq("id", product.id);

        if (updateError) {
          console.error(
            `  ❌ Error updating product ${product.id}:`,
            updateError,
          );
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

    console.log(`\n=== Done: ${updated} updated, ${errors} errors ===\n`);
    return { updated, errors };
  } catch (err) {
    console.error("Error in recalculateAirFreightProducts:", err);
    throw err;
  }
};

// GET all freight rates (sorted by most recent)
router.get("/", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;

    const { data: rates, error } = await supabase
      .from("freight_rates")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (error) throw error;

    res.json(rates);
  } catch (err) {
    console.error("Error fetching freight rates:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// GET freight rates for a specific country
router.get("/country/:country", async (req, res) => {
  try {
    const { country } = req.params;

    const { data: rates, error } = await supabase
      .from("freight_rates")
      .select("*")
      .eq("country", country)
      .order("updated_at", { ascending: false });

    if (error) throw error;

    res.json(rates);
  } catch (err) {
    console.error("Error fetching freight rates by country:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// GET latest rate for a specific country and airport
router.get(
  "/country/:country/airport/:airport_code/latest",
  async (req, res) => {
    try {
      const { country, airport_code } = req.params;

      const { data: rate, error } = await supabase
        .from("freight_rates")
        .select("*")
        .eq("country", country)
        .eq("airport_code", airport_code.toUpperCase())
        .order("updated_at", { ascending: false })
        .limit(1)
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          return res
            .status(404)
            .json({ message: "No rate found for this country and airport" });
        }
        throw error;
      }

      res.json(rate);
    } catch (err) {
      console.error("Error fetching latest rate by country and airport:", err);
      res.status(500).json({ message: "Server error", error: err.message });
    }
  },
);

// GET latest rate for a specific country (any airport)
router.get("/country/:country/latest", async (req, res) => {
  try {
    const { country } = req.params;

    const { data: rate, error } = await supabase
      .from("freight_rates")
      .select("*")
      .eq("country", country)
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res
          .status(404)
          .json({ message: "No rate found for this country" });
      }
      throw error;
    }

    res.json(rate);
  } catch (err) {
    console.error("Error fetching latest rate by country:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// POST - Create new freight rate and recalculate affected products
router.post("/", async (req, res) => {
  try {
    const {
      country,
      airport_code,
      airport_name,
      rate_45kg,
      rate_100kg,
      rate_300kg,
      rate_500kg,
      date,
    } = req.body;

    if (
      !country ||
      !airport_code ||
      !airport_name ||
      !rate_45kg ||
      !rate_100kg ||
      !rate_300kg ||
      !rate_500kg
    ) {
      return res.status(400).json({
        message:
          "Country, airport code, airport name, and all weight tier rates are required",
      });
    }

    if (
      parseFloat(rate_45kg) <= 0 ||
      parseFloat(rate_100kg) <= 0 ||
      parseFloat(rate_300kg) <= 0 ||
      parseFloat(rate_500kg) <= 0
    ) {
      return res
        .status(400)
        .json({ message: "All rates must be greater than 0" });
    }

    const insertData = {
      country: country.trim(),
      airport_code: airport_code.trim().toUpperCase(),
      airport_name: airport_name.trim(),
      rate_45kg: parseFloat(rate_45kg),
      rate_100kg: parseFloat(rate_100kg),
      rate_300kg: parseFloat(rate_300kg),
      rate_500kg: parseFloat(rate_500kg),
      date: date || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data: newRate, error } = await supabase
      .from("freight_rates")
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      throw error;
    }

    // Recalculate affected products
    const recalcResult = await recalculateAirFreightProducts(
      insertData.country,
      insertData.airport_code,
      {
        rate_45kg: insertData.rate_45kg,
        rate_100kg: insertData.rate_100kg,
        rate_300kg: insertData.rate_300kg,
        rate_500kg: insertData.rate_500kg,
      },
    );

    res.status(201).json({
      message: "Freight rate added successfully",
      data: newRate,
      recalculation: {
        productsUpdated: recalcResult.updated,
        errors: recalcResult.errors,
      },
    });
  } catch (err) {
    console.error("Error adding freight rate:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// PUT - Update existing freight rate and recalculate affected products
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      country,
      airport_code,
      airport_name,
      rate_45kg,
      rate_100kg,
      rate_300kg,
      rate_500kg,
      date,
    } = req.body;

    if (
      !country ||
      !airport_code ||
      !airport_name ||
      !rate_45kg ||
      !rate_100kg ||
      !rate_300kg ||
      !rate_500kg
    ) {
      return res.status(400).json({
        message:
          "Country, airport code, airport name, and all weight tier rates are required",
      });
    }

    if (
      parseFloat(rate_45kg) <= 0 ||
      parseFloat(rate_100kg) <= 0 ||
      parseFloat(rate_300kg) <= 0 ||
      parseFloat(rate_500kg) <= 0
    ) {
      return res
        .status(400)
        .json({ message: "All rates must be greater than 0" });
    }

    const updateData = {
      country: country.trim(),
      airport_code: airport_code.trim().toUpperCase(),
      airport_name: airport_name.trim(),
      rate_45kg: parseFloat(rate_45kg),
      rate_100kg: parseFloat(rate_100kg),
      rate_300kg: parseFloat(rate_300kg),
      rate_500kg: parseFloat(rate_500kg),
      date: date || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data: updatedRate, error } = await supabase
      .from("freight_rates")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("Supabase update error:", error);
      throw error;
    }

    // Recalculate affected products
    const recalcResult = await recalculateAirFreightProducts(
      updateData.country,
      updateData.airport_code,
      {
        rate_45kg: updateData.rate_45kg,
        rate_100kg: updateData.rate_100kg,
        rate_300kg: updateData.rate_300kg,
        rate_500kg: updateData.rate_500kg,
      },
    );

    res.json({
      message: "Freight rate updated successfully",
      data: updatedRate,
      recalculation: {
        productsUpdated: recalcResult.updated,
        errors: recalcResult.errors,
      },
    });
  } catch (err) {
    console.error("Error updating freight rate:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// DELETE - Remove freight rate
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from("freight_rates")
      .delete()
      .eq("id", id);

    if (error) throw error;

    res.json({ message: "Freight rate deleted successfully" });
  } catch (err) {
    console.error("Error deleting freight rate:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// GET rate for specific date, country, and airport
router.get(
  "/date/:date/country/:country/airport/:airport_code",
  async (req, res) => {
    try {
      const { date, country, airport_code } = req.params;
      const searchDate = new Date(date);

      const startOfDay = new Date(
        searchDate.setHours(0, 0, 0, 0),
      ).toISOString();
      const endOfDay = new Date(
        searchDate.setHours(23, 59, 59, 999),
      ).toISOString();

      const { data: rate, error } = await supabase
        .from("freight_rates")
        .select("*")
        .eq("country", country)
        .eq("airport_code", airport_code.toUpperCase())
        .gte("date", startOfDay)
        .lte("date", endOfDay)
        .order("updated_at", { ascending: false })
        .limit(1)
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          return res.status(404).json({
            message: "No rate found for this date, country, and airport",
          });
        }
        throw error;
      }

      res.json(rate);
    } catch (err) {
      console.error("Error fetching rate by date, country, and airport:", err);
      res.status(500).json({ message: "Server error", error: err.message });
    }
  },
);

// GET rate for specific date and country (legacy - any airport)
router.get("/date/:date/country/:country", async (req, res) => {
  try {
    const { date, country } = req.params;
    const searchDate = new Date(date);

    const startOfDay = new Date(searchDate.setHours(0, 0, 0, 0)).toISOString();
    const endOfDay = new Date(
      searchDate.setHours(23, 59, 59, 999),
    ).toISOString();

    const { data: rate, error } = await supabase
      .from("freight_rates")
      .select("*")
      .eq("country", country)
      .gte("date", startOfDay)
      .lte("date", endOfDay)
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res
          .status(404)
          .json({ message: "No rate found for this date and country" });
      }
      throw error;
    }

    res.json(rate);
  } catch (err) {
    console.error("Error fetching rate by date and country:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

export default router;
