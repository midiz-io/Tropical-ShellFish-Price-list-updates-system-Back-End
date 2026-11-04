import express from 'express'
import supabase from '../db.js'
import multer from 'multer'
import { extname } from 'path'

const router = express.Router()

const storage = multer.memoryStorage()
const upload = multer({ storage })

router.get('/', async (req, res) => {
  try {
    const { data: customers, error } = await supabase
      .from('customers')
      .select(`
        *
      `)
      .order('cus_id')

    if (error) throw error

    res.json(customers)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Database error', details: err.message })
  }
})

router.get('/:id', async (req, res) => {
  try {
    const { data: customer, error } = await supabase
      .from('customers')
      .select(`
        *
      `)
      .eq('cus_id', req.params.id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Customer not found' })
      }
      throw error
    }

    res.json(customer)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Database error', details: err.message })
  }
})

router.post('/upload', upload.single('image'), async (req, res) => {
  const { cus_name, company_name, phone, address, country, airport, email } = req.body
  let image_url = null

  try {
    // Upload image to Supabase Storage if provided
    if (req.file) {
      const fileName = `${Date.now()}${extname(req.file.originalname)}`
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('customer-images')
        .upload(fileName, req.file.buffer, {
          contentType: req.file.mimetype
        })

      if (uploadError) throw uploadError

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('customer-images')
        .getPublicUrl(fileName)

      image_url = publicUrl
    }

    // Insert customer
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .insert({
        cus_name,
        company_name,
        phone,
        address, 
        country, 
        airport, 
        email,
        image_url
      })
      .select()
      .single()

    if (customerError) throw customerError

    res.status(201).json(customer)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Database error', details: err.message })
  }
})

// PUT - Update customer
router.put('/upload/:id', upload.single('image'), async (req, res) => {
  const { cus_name, company_name, phone, address, country, airport, email, existing_image_url } = req.body
  let image_url = existing_image_url

  try {
    // Upload new image if provided
    if (req.file) {
      const fileName = `${Date.now()}${extname(req.file.originalname)}`
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('customer-images')
        .upload(fileName, req.file.buffer, {
          contentType: req.file.mimetype
        })

      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage
        .from('customer-images')
        .getPublicUrl(fileName)

      image_url = publicUrl
    }

    // Update customer
    const { data: customer, error: updateError } = await supabase
      .from('customers')
      .update({
        cus_name,
        company_name,
        phone,
        address, 
        country, 
        airport, 
        email,
        image_url
      })
      .eq('cus_id', req.params.id)
      .select()
      .single()

    if (updateError) throw updateError

    res.json(customer)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Database error', details: err.message })
  }
})

// DELETE customer
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('customers')
      .delete()
      .eq('cus_id', req.params.id)

    if (error) throw error

    res.json({ message: 'Customer deleted' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Database error', details: err.message })
  }
})

export default router