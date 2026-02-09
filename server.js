const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// API Configuration
const API_KEY = '2d64de63fd1c94e4ddecc7024c5e5391d8efbe29edb2888767c7b0c75ace6cdc';
const API_ENDPOINT = 'https://oreo.gleeze.com/api/autodl';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '.')));

// Rate limiting middleware (simple implementation)
const requestCounts = {};
app.use((req, res, next) => {
    const ip = req.ip;
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute
    const maxRequests = 30; // 30 requests per minute
    
    if (!requestCounts[ip]) {
        requestCounts[ip] = [];
    }
    
    // Remove old requests
    requestCounts[ip] = requestCounts[ip].filter(time => now - time < windowMs);
    
    if (requestCounts[ip].length >= maxRequests) {
        return res.status(429).json({
            success: false,
            message: 'Too many requests. Please try again later.'
        });
    }
    
    requestCounts[ip].push(now);
    next();
});

// Helper function to detect platform from URL
function detectPlatform(url) {
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
        return 'YouTube';
    } else if (url.includes('tiktok.com')) {
        return 'TikTok';
    } else if (url.includes('instagram.com')) {
        return 'Instagram';
    } else if (url.includes('facebook.com') || url.includes('fb.watch')) {
        return 'Facebook';
    } else if (url.includes('twitter.com') || url.includes('x.com')) {
        return 'X.com';
    }
    return 'Unknown';
}

// Main download endpoint
app.post('/download', async (req, res) => {
    try {
        const { url, stream = true } = req.body;
        
        if (!url) {
            return res.status(400).json({
                success: false,
                message: 'Please enter a video URL'
            });
        }
        
        // Construct API URL
        const apiUrl = `${API_ENDPOINT}?url=${encodeURIComponent(url)}&stream=${stream}&api_key=${API_KEY}`;
        
        console.log(`Processing URL: ${url.substring(0, 50)}...`);
        
        // Call the external API with timeout
        const response = await axios.get(apiUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9'
            },
            timeout: 45000 // 45 seconds timeout for mobile networks
        });
        
        const data = response.data;
        const platform = detectPlatform(url);
        
        // Process API response
        if (data.error && data.error !== "URL parameter is required") {
            return res.json({
                success: true,
                data: {
                    error: data.error,
                    platform: platform,
                    supported_platforms: data.supported_platforms || ['YouTube', 'TikTok', 'Instagram', 'Facebook', 'X.com']
                }
            });
        }
        
        // Format the response for mobile-friendly display
        const formattedResponse = {
            platform: platform,
            ...data
        };
        
        // Ensure formats array exists for consistent UI
        if (!formattedResponse.formats && formattedResponse.direct_url) {
            formattedResponse.formats = [{
                quality: 'Best Available',
                url: formattedResponse.direct_url,
                container: 'MP4',
                hasAudio: true
            }];
        }
        
        // Limit formats for mobile performance
        if (formattedResponse.formats && formattedResponse.formats.length > 10) {
            formattedResponse.formats = formattedResponse.formats.slice(0, 10);
        }
        
        // Add mobile-optimized properties
        if (formattedResponse.formats) {
            formattedResponse.formats.forEach(format => {
                if (!format.quality && format.resolution) {
                    format.quality = format.resolution;
                }
                // Add file size estimation for better UX
                if (!format.fileSize && format.bitrate) {
                    format.fileSize = estimateFileSize(format.bitrate);
                }
            });
        }
        
        return res.json({
            success: true,
            data: formattedResponse
        });
        
    } catch (error) {
        console.error('Download error:', error.message);
        
        // Mobile-friendly error messages
        if (error.code === 'ECONNABORTED') {
            return res.status(504).json({
                success: false,
                message: 'Request timeout. Please check your connection and try again.'
            });
        }
        
        if (error.response) {
            const status = error.response.status;
            let message = 'Service temporarily unavailable.';
            
            if (status === 404) {
                message = 'Video not found. Please check the URL.';
            } else if (status === 403) {
                message = 'Access denied. The video might be private or restricted.';
            } else if (status >= 500) {
                message = 'Server error. Please try again in a few moments.';
            }
            
            return res.status(status).json({
                success: false,
                message: message
            });
        }
        
        return res.status(500).json({
            success: false,
            message: 'Unable to process your request. Please try again.'
        });
    }
});

// Helper function to estimate file size
function estimateFileSize(bitrate) {
    if (!bitrate) return null;
    
    // Convert bitrate string like "128kbps" to number
    const bitrateNum = parseInt(bitrate);
    if (isNaN(bitrateNum)) return null;
    
    // Estimate for 3-minute video
    const sizeInMB = (bitrateNum * 180) / (8 * 1024); // Convert to MB
    return sizeInMB > 1000 
        ? `${(sizeInMB / 1024).toFixed(1)} GB` 
        : `${Math.round(sizeInMB)} MB`;
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'VidSnap Downloader API',
        version: '1.0.0'
    });
});

// Serve main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Cache static assets for better mobile performance
app.use('/assets', express.static(path.join(__dirname, 'assets'), {
    maxAge: '1d'
}));

// Start server with optimized settings for mobile
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ============================================
    🚀 VidSnap Downloader Server Started!
    ============================================
    📱 Mobile-optimized video downloader
    🌐 Local: http://localhost:${PORT}
    🔧 Port: ${PORT}
    ⏰ Time: ${new Date().toLocaleTimeString()}
    ============================================
    `);
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    server.close(() => {
        console.log('Server closed.');
        process.exit(0);
    });
});

// Error handling for uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    // Don't crash the server, just log the error
});

// Keep-alive timeout for mobile connections
server.keepAliveTimeout = 120000; // 120 seconds
server.headersTimeout = 125000; // 125 seconds