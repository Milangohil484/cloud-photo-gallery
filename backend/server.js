const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
require('dotenv').config();

// Modern AWS SDK v3 Client imports
const {
    S3Client,
    PutObjectCommand,
    DeleteObjectCommand,
    GetObjectCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const app = express();
app.use(cors());
app.use(express.json());

// Database Hook 
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✨ Connected to MongoDB Instance cleanly."))
    .catch(err => console.error("Database alignment crash error:", err));

// Database Schemas (Matches ER Diagram Structure)
const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});

const photoSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    photoName: { type: String, required: true },
    description: { type: String, default: "" },
    uploadDate: { type: Date, default: Date.now },
    s3_Url: { type: String, required: true },
    fileSize: { type: Number, required: true }
});

const User = mongoose.model('User', userSchema);
const Photo = mongoose.model('Photo', photoSchema);

// AWS SDK v3 Client Instance
const s3Client = new S3Client({
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    },
    region: process.env.AWS_REGION
});

// --- API WORKFLOW ROUTING ---

// 1. User Registration Route
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        if (!name || !email || !password) {
            return res.status(400).json({ message: "All form input fields are required." });
        }
        
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: "An account already exists with this email address." });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ name, email, password: hashedPassword });
        await newUser.save();

        res.status(201).json({ message: "Registration verified." });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// 2. User Login Route
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ message: "Please provide both email and password inputs." });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: "No registered profile located matching this email." });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: "Incorrect password verification sequence." });
        }

        res.status(200).json({ userId: user._id, name: user.name });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// 3. Request Secure S3 Presigned Upload token
app.post('/api/photos/presign', async (req, res) => {
    try {
        const { filename, filetype, userId } = req.body;
        if (!userId) return res.status(400).json({ message: "Active user context parameter missing." });

        const uniqueKey = `${userId}/${crypto.randomBytes(8).toString('hex')}-${filename}`;
        
        const command = new PutObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: uniqueKey,
            ContentType: filetype
        });

        // URL expires in 300 seconds (5 minutes)
        const uploadURL = await getSignedUrl(s3Client, command, { expiresIn: 300 });
        res.status(200).json({ uploadURL, key: uniqueKey });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// 4. Save Photo Asset Verification Metadata Log
app.post('/api/photos/save', async (req, res) => {
    try {
        const { userId, photoName, description,s3Key, fileSize } = req.body;
        const s3_Url = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;
        
        const newPhoto = new Photo({ userId, photoName,description, s3_Url, fileSize });
        await newPhoto.save();
        
        res.status(201).json(newPhoto);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// 5. Fetch Gallery Matrix Items
app.get('/api/photos/:userId', async (req, res) => {
    try {
        const photos = await Photo.find({ userId: req.params.userId }).sort({ uploadDate: -1 });
        res.status(200).json(photos);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// 6. Delete Cloud Media Asset Operation
app.delete('/api/photos/:photoId', async (req, res) => {
    try {
        const photo = await Photo.findById(req.params.photoId);
        if (!photo) return res.status(404).json({ message: "Asset database track matching missing." });

        const s3Key = photo.s3_Url.split('.amazonaws.com/')[1];

        const deleteCommand = new DeleteObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: s3Key
        });
        await s3Client.send(deleteCommand);

        await Photo.findByIdAndDelete(req.params.photoId);
        res.status(200).json({ message: "Cloud object cleared out cleanly." });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// 7. Generate Secure Download URL
app.get('/api/photos/download/:photoId', async (req, res) => {
    try {
        const photo = await Photo.findById(req.params.photoId);

        if (!photo) {
            return res.status(404).json({
                message: "Photo not found."
            });
        }

        const s3Key = photo.s3_Url.split('.amazonaws.com/')[1];

        const command = new GetObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: s3Key,
            ResponseContentDisposition: `attachment; filename="${photo.photoName}"`
        });

        const downloadURL = await getSignedUrl(s3Client, command, {
            expiresIn: 300
        });

        res.status(200).json({
            downloadURL
        });

    } catch (error) {
        res.status(500).json({
            message: error.message
        });
    }
});

// Start Server
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`🚀 Advanced Server executing smoothly on port ${PORT}`);
});