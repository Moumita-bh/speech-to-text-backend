import express from 'express'
import cors from 'cors'
import multer from 'multer'
import fs from 'fs'
import dotenv from 'dotenv'
import { OpenAI } from 'openai'
import { createClient } from '@supabase/supabase-js'

// Load env vars
dotenv.config()

const app = express()
const port = process.env.PORT || 4000

app.use(cors())
app.use(express.json())

// OpenAI setup
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

// Supabase setup
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Multer for file upload
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
})

// Route: POST /upload
app.post('/upload', upload.single('audio'), async (req, res) => {
  const file = req.file
  if (!file) return res.status(400).json({ error: 'No file uploaded' })

  try {
    // 1. Transcribe using OpenAI Whisper
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(file.path),
      model: 'whisper-1',
    })

    const text = transcription.text
    const filename = `${Date.now()}-${file.originalname}`

    // 2. Upload audio file to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from(process.env.SUPABASE_BUCKET)
      .upload(filename, fs.createReadStream(file.path), {
        contentType: file.mimetype,
      })

    if (uploadError) {
      console.error('Storage Error:', uploadError)
      return res.status(500).json({ error: 'Failed to upload audio to Supabase Storage' })
    }

    const fileUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/${process.env.SUPABASE_BUCKET}/${filename}`

    // 3. Store transcription in Supabase table
    const { error: insertError } = await supabase
      .from('transcriptions')
      .insert([
        {
          filename: filename,
          transcription: text,
          file_url: fileUrl,
          uploaded_at: new Date().toISOString(),
        },
      ])

    if (insertError) {
      console.error('Insert Error:', insertError)
      return res.status(500).json({ error: 'Failed to insert into Supabase DB' })
    }

    // 4. Clean up temp file
    fs.unlinkSync(file.path)

    res.json({
      message: 'Transcription successful',
      transcription: text,
      file_url: fileUrl,
    })
  } catch (err) {
  console.error('🔥 Full error:', err.response?.data || err.message || err)
  res.status(500).json({ error: 'Transcription failed' })
}
})

// Start server
app.listen(port, () => {
  console.log(`✅ Server running at http://localhost:${port}`)
})
