import express from "express";
import supabase from "../db.js";
import multer from "multer";
import { extname } from "path";

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({ storage });

router.get("/", async (req, res) => {
  try {
    const { data: customers, error } = await supabase
      .from("exportcustomersair")
      .select("*")
      .order("cus_id");

    if (error) throw error;

    res.json(customers);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error", details: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const { data: customer, error } = await supabase
      .from("exportcustomersair")
      .select("*")
      .eq("cus_id", req.params.id)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res.status(404).json({ error: "Customer not found" });
      }
      throw error;
    }

    res.json(customer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error", details: err.message });
  }
});

router.post("/upload", upload.single("image"), async (req, res) => {
  const {
    cus_name,
    company_name,
    phone,
    address,
    country,
    airport_code,
    airport_name,
    port_code, // ✅ added
    port_name, // ✅ added
    email,
  } = req.body;
  let image_url = null;

  try {
    if (req.file) {
      const fileName = `${Date.now()}${extname(req.file.originalname)}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("customer-images")
        .upload(fileName, req.file.buffer, {
          contentType: req.file.mimetype,
        });

      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from("customer-images").getPublicUrl(fileName);

      image_url = publicUrl;
    }

    const { data: customer, error: customerError } = await supabase
      .from("exportcustomersair")
      .insert({
        cus_name,
        company_name,
        phone,
        address,
        country,
        airport_code: airport_code ? airport_code.toUpperCase() : null,
        airport_name: airport_name || null,
        port_code: port_code ? port_code.toUpperCase() : null, // ✅ added
        port_name: port_name || null, // ✅ added
        email,
        image_url,
      })
      .select()
      .single();

    if (customerError) throw customerError;

    res.status(201).json(customer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error", details: err.message });
  }
});

// PUT - Update customer
router.put("/upload/:id", upload.single("image"), async (req, res) => {
  const {
    cus_name,
    company_name,
    phone,
    address,
    country,
    airport_code,
    airport_name,
    port_code, // ✅ added
    port_name, // ✅ added
    email,
    existing_image_url,
  } = req.body;
  let image_url = existing_image_url;

  try {
    if (req.file) {
      const fileName = `${Date.now()}${extname(req.file.originalname)}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("customer-images")
        .upload(fileName, req.file.buffer, {
          contentType: req.file.mimetype,
        });

      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from("customer-images").getPublicUrl(fileName);

      image_url = publicUrl;
    }

    const { data: customer, error: updateError } = await supabase
      .from("exportcustomersair")
      .update({
        cus_name,
        company_name,
        phone,
        address,
        country,
        airport_code: airport_code ? airport_code.toUpperCase() : null,
        airport_name: airport_name || null,
        port_code: port_code ? port_code.toUpperCase() : null, // ✅ added
        port_name: port_name || null, // ✅ added
        email,
        image_url,
      })
      .eq("cus_id", req.params.id)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json(customer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error", details: err.message });
  }
});

// DELETE customer
router.delete("/:id", async (req, res) => {
  try {
    const { error } = await supabase
      .from("exportcustomersair")
      .delete()
      .eq("cus_id", req.params.id);

    if (error) throw error;

    res.json({ message: "Customer deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error", details: err.message });
  }
});

export default router;
