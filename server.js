const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5001;

// Enable JSON body parsing
app.use(express.json());

// Enable CORS for your domains
app.use(cors({ 
  origin: ['https://shauneekai.com', 'http://localhost:5173', 'https://iloveshaunee.web.app'],
  credentials: true 
}));

// Get Spotify credentials from environment variables
const spotify_client_id = process.env.SPOTIFY_CLIENT_ID;
const spotify_client_secret = process.env.SPOTIFY_CLIENT_SECRET;

// Token storage (persisted to file)
const TOKEN_FILE = path.join(__dirname, '.spotify_tokens.json');

let tokens = {
  access_token: '',
  refresh_token: '',
  expires_at: 0
};

// Load tokens from file on startup
const loadTokens = () => {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const data = fs.readFileSync(TOKEN_FILE, 'utf8');
      tokens = JSON.parse(data);
      console.log('✅ Loaded saved tokens from file');
      console.log('🔑 Access token:', tokens.access_token ? tokens.access_token.substring(0, 20) + '...' : 'NONE');
      console.log('🔄 Refresh token:', tokens.refresh_token ? 'EXISTS' : 'NONE');
      console.log('⏰ Expires at:', tokens.expires_at ? new Date(tokens.expires_at).toLocaleString() : 'UNKNOWN');
      
      // Check if token is expired and refresh if needed
      if (tokens.refresh_token && Date.now() >= tokens.expires_at) {
        console.log('⚠️ Access token expired, refreshing...');
        refreshAccessToken();
      }
    } else {
      console.log('ℹ️ No saved tokens found - user needs to login');
    }
  } catch (error) {
    console.error('❌ Error loading tokens:', error);
  }
};

// Save tokens to file
const saveTokens = () => {
  try {
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
    console.log('💾 Tokens saved to file');
  } catch (error) {
    console.error('❌ Error saving tokens:', error);
  }
};

// Determine redirect URI based on environment
const getRedirectUri = () => {
  return process.env.NODE_ENV === 'production'
    ? 'https://spotify-auth-server-7bp9.onrender.com/auth/callback'
    : 'http://127.0.0.1:5173/auth/callback';
};

// Generate random string for state
const generateRandomString = (length) => {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  
  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
};

// Refresh access token
const refreshAccessToken = async () => {
  if (!tokens.refresh_token) {
    console.log('⚠️ No refresh token available');
    return false;
  }
  
  console.log('🔄 Refreshing access token...');
  
  try {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(spotify_client_id + ':' + spotify_client_secret).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token
      })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      tokens.access_token = data.access_token;
      tokens.expires_at = Date.now() + (data.expires_in * 1000);
      
      if (data.refresh_token) {
        tokens.refresh_token = data.refresh_token;
      }
      
      saveTokens();
      console.log('✅ Access token refreshed!');
      return true;
    } else {
      console.error('❌ Failed to refresh token:', data);
      return false;
    }
  } catch (error) {
    console.error('❌ Error refreshing token:', error);
    return false;
  }
};

// Auto-refresh token before it expires
setInterval(() => {
  if (tokens.refresh_token && Date.now() >= tokens.expires_at - (10 * 60 * 1000)) {
    console.log('⏰ Token expiring soon, auto-refreshing...');
    refreshAccessToken();
  }
}, 10 * 60 * 1000);

// Manual token setup endpoint (use once, then remove)
app.post('/setup-token', (req, res) => {
  const { access_token, refresh_token, expires_at } = req.body;
  
  if (access_token && refresh_token) {
    tokens.access_token = access_token;
    tokens.refresh_token = refresh_token;
    tokens.expires_at = expires_at;
    
    saveTokens();
    
    console.log('✅ Tokens manually set!');
    res.json({ success: true, message: 'Tokens saved!' });
  } else {
    res.status(400).json({ error: 'Missing token data' });
  }
});

// Login - Request User Authorization
app.get('/auth/login', (req, res) => {
  console.log('🔐 Login request received');
  
  const scope = `streaming 
    user-read-email 
    user-read-private
    user-read-playback-state
    user-modify-playback-state
    playlist-read-private
    playlist-read-collaborative`;
  
  const state = generateRandomString(16);
  const redirectUri = getRedirectUri();
  
  const auth_query_parameters = new URLSearchParams({
    response_type: 'code',
    client_id: spotify_client_id,
    scope: scope,
    redirect_uri: redirectUri,
    state: state
  });
  
  console.log('📍 Using redirect URI:', redirectUri);
  
  res.redirect('https://accounts.spotify.com/authorize/?' + auth_query_parameters.toString());
});

// Callback - Exchange Authorization Code for Access Token
app.get('/auth/callback', async (req, res) => {
  const code = req.query.code;
  const redirectUri = getRedirectUri();
  
  const authOptions = {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(spotify_client_id + ':' + spotify_client_secret).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      code: code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    })
  };
  
  console.log('📍 Callback using redirect URI:', redirectUri);
  
  try {
    const response = await fetch('https://accounts.spotify.com/api/token', authOptions);
    const data = await response.json();
    
    if (response.ok) {
      tokens.access_token = data.access_token;
      tokens.refresh_token = data.refresh_token;
      tokens.expires_at = Date.now() + (data.expires_in * 1000);
      
      saveTokens();
      
      console.log('✅ Tokens received and saved!');
      console.log('🎵 Access token:', tokens.access_token.substring(0, 20) + '...');
      
      // Redirect back to your app
      res.redirect('https://shauneekai.com/?spotify=connected');
    } else {
      console.error('❌ Failed to get token:', data);
      res.send('Authentication failed: ' + JSON.stringify(data));
    }
  } catch (error) {
    console.error('❌ Auth error:', error);
    res.send('Authentication error: ' + error.message);
  }
});

// Return Access Token to Frontend
app.get('/auth/token', async (req, res) => {
  console.log('📥 /auth/token route called');
  
  // Check if token is expired and refresh if needed
  if (tokens.refresh_token && Date.now() >= tokens.expires_at) {
    console.log('⚠️ Token expired, refreshing...');
    await refreshAccessToken();
  }
  
  res.json({
    access_token: tokens.access_token,
    is_authenticated: !!tokens.access_token
  });
});

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'iloveshaunee auth server running',
    has_token: !!tokens.access_token
  });
});

// Load tokens on startup
loadTokens();

app.listen(PORT, () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🚀 Server listening at http://localhost:${PORT}`);
  console.log(`📋 Client ID: ${spotify_client_id ? 'Set ✅' : 'Missing ❌'}`);
  console.log(`🔑 Client Secret: ${spotify_client_secret ? 'Set ✅' : 'Missing ❌'}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📍 Redirect URI: ${getRedirectUri()}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});// Updated
