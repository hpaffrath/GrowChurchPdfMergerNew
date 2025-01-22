require("dotenv").config();
const express = require("express");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const expressSession = require("express-session")
const { google } = require("googleapis");
const { createLogger, format, transports} = require("winston")
const leader = require ("./leaders.json");

const app = express();

app.use(express.static("data"));



// Middleware
app.use(express.static("public"));
app.use(
    expressSession({
        secret: process.env.SESSION_SECRET || "default_secret_key",
        resave: false,
        saveUninitialized: false,
        cookie: {
            maxAge: 24 * 60 * 60 * 1000, // 24 hours
        },
    })
);


// Configure Passport
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "/auth/google/callback",
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


app.use(passport.initialize());
app.use(passport.session());

// Google Drive Helper
const getDriveFiles = async (accessToken) => {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const drive = google.drive({ version: "v3", auth });
  try {
    const response = await drive.files.list({
      pageSize: 10,
      fields: "files(id, name)",
    });
    return response.data.files;
  } catch (error) {
    console.error("Error accessing Google Drive:", error);
    throw error;
  }
};

// Routes
app.get("/", (req, res) => {
  res.send(`
     <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Google Auth App</title>
      <link rel="stylesheet" href="/styles/style.css">
    </head>
    <body>
    <h1>Grow Church PDF Merger</h1>
    ${req.isAuthenticated() 
      ? `<p>Select a Worship Leader</p>
          <div>
          <select name="leader" id="leader">
             ${leader.data.map((item) => `<option value="${item.leader}">${item.leader}</option>`).join('')}
           </select>
        </div>



        <a href="/drive">View Google Drive Files</a>
         <div>
         <form action="/logout" method="get" style="display: inline;">
           <button type="submit" style="
             background-color: #4285F4; 
             color: white; 
             border: none; 
             padding: 10px 20px; 
             text-align: center; 
             text-decoration: none; 
             display: inline-block; 
             font-size: 16px; 
             border-radius: 5px; 
             cursor: pointer;">
             Logout
           </button>
         </form>
         </div>` 
      : `<form action="/auth/google" method="get" style="display: inline;">
           <button type="submit" style="
             background-color: #4285F4; 
             color: white; 
             border: none; 
             padding: 10px 20px; 
             text-align: center; 
             text-decoration: none; 
             display: inline-block; 
             font-size: 16px; 
             border-radius: 5px; 
             cursor: pointer;">
             Login with Google
           </button>
         </form>`
    }
        </body>
    </html>
  `);
});



app.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: ["profile", "email", "https://www.googleapis.com/auth/drive.readonly"], // Added scope for Google Drive
  })
);

app.get(
  "/auth/google/callback",
  passport.authenticate("google", {
    failureRedirect: "/",
  }),
  (req, res) => {
    res.redirect("/");
  }
);

app.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).send("Error logging out.");
    }
    res.redirect("/");
  });
});

// Protected route for Google Drive
app.get("/drive", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/");
  }

  try {
    const files = await getDriveFiles(req.user.accessToken);
    res.send(`
      <h1>Google Drive Files</h1>
      <ul>
        ${files.map((file) => `<li>${file.name} (ID: ${file.id})</li>`).join("")}
      </ul>
      <a href="/">Go Back</a>
    `);
  } catch (error) {
    res.status(500).send("Failed to fetch Google Drive files.");
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
