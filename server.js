import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Root route
app.get("/", (req, res) => {
  res.json({
    message: "Tropical Shellfish API",
    status: "Running",
    endpoints: {
      productlist: "/api/productlist",
      customerlist: "/api/customerlist",
      customerProducts: "/api/customer-products",
      exportproductlist: "/api/exportproductlist",
      exportcustomerlist: "/api/exportcustomerlist",
      exportcustomerProducts: "/api/exportcustomer-products",
      usdrate: "/api/usd-rate",
    },
  });
});

// Import routes

import authRoutes from "./routes/auth.js";
app.use("/api/auth", authRoutes);

import customerlistRouter from "./routes/customerlist.js";
app.use("/api/customerlist", customerlistRouter);

import customerProductsRouter from "./routes/customerProducts.js";
app.use("/api/customer-products", customerProductsRouter);

import exportproductlistRouter from "./routes/exportproductlist.js";
app.use("/api/exportproductlist", exportproductlistRouter);

import exportcustomerlistRouter from "./routes/exportcustomerlist.js";
app.use("/api/exportcustomerlist", exportcustomerlistRouter);

import exportcustomerlistairRouter from "./routes/exportcustomerlistair.js";
app.use("/api/exportcustomerlistair", exportcustomerlistairRouter);

import exportcustomerProductsRouter from "./routes/exportcustomerProducts.js";
app.use("/api/exportcustomer-products", exportcustomerProductsRouter);

import exportcustomerProductsAirRouter from "./routes/exportcustomerProductsAir.js";
app.use("/api/exportcustomer-productsair", exportcustomerProductsAirRouter);

import usdrateRouter from "./routes/usdrate.js";
app.use("/api/usd-rate", usdrateRouter);

import feightrateRouter from "./routes/Freightratesroutes.js";
app.use("/api/freight-rates", feightrateRouter);

import seafreightrateRouter from "./routes/seafreightratesroute.js";
app.use("/api/sea-freight-rates", seafreightrateRouter);

// Serve uploaded images
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

import customerAuthRouter from "./routes/customerauth.js";
app.use("/api/customer-auth", customerAuthRouter);

import ordersRouter from "./routes/orders.js";
app.use("/api/orders", ordersRouter);

import invoicesRouter from "./routes/invoices.js";
app.use("/api/invoices", invoicesRouter);

import productlistRouter from "./routes/productlist.js";
import localProductPricesRouter from "./routes/local-product-prices.js";

app.use("/api/productlist", productlistRouter);
app.use("/api/local-product-prices", localProductPricesRouter);

import exportproductlistairRouter from "./routes/exportproductlistair.js";
app.use("/api/exportproductlistair", exportproductlistairRouter);

// For local development
if (process.env.NODE_ENV !== "production") {
  const port = process.env.PORT || 5000;
  app.listen(port, () => console.log(`API listening on port ${port}`));
}

// Export for Vercel
export default app;
