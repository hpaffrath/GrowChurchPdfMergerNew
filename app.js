require("dotenv").config();                                         // npm install dotenv
const express = require('express');                                // npm install express
const expressSession = require("express-session");  
const pico = require('picocolors');                                // npm install picocolors
const path = require('path');  
const passport = require('passport');                              // npm install passport
const GoogleStrategy = require('passport-google-oauth20').Strategy; // npm install passport-google-oauth20
const { google } = require("googleapis");                          // npm install @googleapis/drive

// PDF Merging  `npm install pdf-lib axios`
const fs = require('fs');             // Node.js file system module
const axios = require('axios');       // For downloading files
const { PDFDocument } = require('pdf-lib'); // For merging PDFs

// Static data
const leaders = require('./src/public/data/leaders.json');
let selectedLeader = null;
let songsList = null;
let songsListCount = 0;
let selectedSongs = [];

// Google API Scopes
const SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

// Environment variables
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

// Express setup
const PORT = process.env.PORT || 3000;
const app = express();

// Middleware
app.use(
  expressSession({
    secret: process.env.SESSION_SECRET || "default_secret_key",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }, // 24 hours
  })
);
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(path.join(process.cwd(), 'src', 'public')));
app.use(express.urlencoded({ extended: true }));

app.set('view engine', 'ejs');
app.set('views', 'src/public/views');

// Passport Google OAuth configuration
passport.use(
  new GoogleStrategy(
    {
      clientID: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      callbackURL: '/auth/google/callback',
    },
    (accessToken, refreshToken, profile, done) => {
      // Store user profile and access token
      return done(null, { profile, accessToken });
    }
  )
);

// Serialize and deserialize user
passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

// Routes

// Home route
app.get('/', (req, res) => {
  res.status(200).render('template', {
    data: {
      authorized: req.isAuthenticated(),
      leaders: leaders,
      selectedLeader: selectedLeader,
      songsList: songsList,
      songsListCount: songsListCount,
      selectedSongs: selectedSongs,
    },
  });
});

// Google OAuth login route
app.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: ["profile", "email", ...SCOPES], // Added scope for Google Drive
  })
);

// Google OAuth callback route
app.get(
  "/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/" }),
  (req, res) => {
    selectedLeader = null;
    songsList = null;
    songsListCount = 0;
    selectedSongs = [];
    res.redirect("/");
  }
);

// Select leader route
app.post('/selectLeader', (req, res) => {
  selectedLeader = req.body.selectedLeader;

  // Clear the song-related variables when a new leader is selected
  songsList = null;
  songsListCount = 0;
  selectedSongs = [];

  res.redirect("/");
});

// Add song list route
app.post('/addSongList', async (req, res) => {
  songsListCount++;
  console.log(`BODY = ${req.body.selectedSong1}`);
  if (!req.isAuthenticated() || !req.user || !req.user.accessToken) {
    return res.status(401).send('Unauthorized');
  }

  const folderId = selectedLeader; // Ensure this is set correctly
  console.log(`Selected Leader (Folder ID): ${folderId}`);

  try {
    // Fetch the song list for the selected leader
    
    
    songsList = await listFilesInFolder(req.user.accessToken, folderId);

    

    res.redirect("/");

  } catch (error) {
    console.error('Error fetching songs:', error.message);
    res.status(500).send('Failed to fetch song list.');
  }
});

// Remove song list route
app.post('/removeSongList', (req, res) => {
  if (songsListCount > 0) {
    songsListCount--; // Decrease the number of dropdowns
    selectedSongs.pop(); // Remove the last selected song from the array
  }
  res.redirect('/'); // Redirect to refresh the page
});


// Select song route
app.post('/selectedSong', (req, res) => {
  const { selectedSong, songIndex } = req.body;

  // Update selectedSongs for the specific index
  selectedSongs[songIndex] = selectedSong;

  // Redirect back to the home page to update the dropdowns with the selected songs
  res.redirect("/");
});

// Logout route
app.get("/logout", (req, res) => {
  selectedLeader = null;
  songsList = null;
  songsListCount = 0;
  req.logout((err) => {
    if (err) {
      return res.status(500).send("Error logging out.");
    }
    res.redirect("/");
  });
});

// Function to list files in a folder
async function listFilesInFolder(accessToken, folderId) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const drive = google.drive({ version: 'v3', auth });
  try {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'files(id, name)',
    });

    const files = response.data.files;
    if (files && files.length > 0) {
      const songs = files
      .filter(file => file.name.toLowerCase().endsWith('.pdf')) // Filter only PDF files
      .map(file => ({
        song: file.name,
        location: `https://drive.google.com/file/d/${file.id}/view?usp=sharing`,
      }));
      return songs;
    } else {
      console.log('No files found.');
      return [];
    }
  } catch (error) {
    console.error('Error listing files:', error.message);
    throw error;
  }
}

app.post('/merge', async (req, res) => {
  try {
    if (!selectedSongs || selectedSongs.length === 0) {
      return res.status(400).send('No songs selected for merging.');
    }

    // Google OAuth authentication setup
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: req.user.accessToken });
    const drive = google.drive({ version: 'v3', auth });

    const downloadedPdfBuffers = [];

    for (const songUrl of selectedSongs) {
      const fileId = extractFileId(songUrl);
      if (!fileId) continue;

      // Fetch file metadata
      const fileMetadata = await drive.files.get({
        fileId,
        fields: 'id, name, mimeType',
      });

      const { name, mimeType } = fileMetadata.data;

      // Skip non-PDF files
      if (mimeType !== 'application/pdf') {
        console.log(`Skipping non-PDF file: ${name}`);
        continue;
      }

      console.log(`Downloading PDF: ${name}`);

      // Download the PDF
      const response = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'stream' } // Use stream for binary data
      );

      // Collect binary data from the stream
      const chunks = [];
      await new Promise((resolve, reject) => {
        response.data.on('data', (chunk) => chunks.push(chunk));
        response.data.on('end', resolve);
        response.data.on('error', reject);
      });

      downloadedPdfBuffers.push(Buffer.concat(chunks));
    }

    // Validate downloaded PDFs
    if (downloadedPdfBuffers.length === 0) {
      return res.status(400).send('No valid PDF files to merge.');
    }

    console.log(`Merging ${downloadedPdfBuffers.length} PDF files...`);

    // Merge PDFs using pdf-lib
    const mergedPdf = await PDFDocument.create();
    for (const buffer of downloadedPdfBuffers) {
      try {
        const pdf = await PDFDocument.load(buffer); // Load raw binary data
        const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
      } catch (mergeError) {
        console.error(`Error processing a PDF file:`, mergeError.message);
      }
    }

    const mergedPdfBytes = await mergedPdf.save(); // Get binary data for the merged PDF

    // Calculate the next Sunday (not today if today is Sunday)
    const nextSundayDate = getNextSundayDate();
    const filename = `${nextSundayDate}.pdf`;

    // Send the merged PDF to the client with the dynamic filename
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(mergedPdfBytes)); // Send binary data directly
  } catch (error) {
    console.error('Error merging PDFs:', error.message);
    res.status(500).send('Failed to merge PDFs.');
  }
});

// Utility function to extract Google Drive file ID from the URL
function extractFileId(url) {
  const match = url.match(/[-\w]{25,}/);
  return match ? match[0] : null;
}

// Utility function to get the next Sunday (not today if today is Sunday)
function getNextSundayDate() {
  const today = new Date();
  const nextSunday = new Date(today);
  const daysUntilSunday = (7 - today.getDay()) % 7; // 0 for Sunday, 1-6 for Monday-Saturday
  nextSunday.setDate(today.getDate() + daysUntilSunday || 7); // If today is Sunday, skip to next Sunday

  // Format the date as YYYY-MM-DD
  const year = nextSunday.getFullYear();
  const month = String(nextSunday.getMonth() + 1).padStart(2, '0');
  const day = String(nextSunday.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}





// Start the server
app.listen(PORT, () => {
  console.log(`listening on port ${pico.green(PORT)}`);
});
