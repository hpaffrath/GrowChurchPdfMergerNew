require("dotenv").config();
const express = require("express");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const cookieSession = require("cookie-session");
const expressSession = require("express-session")
const { google } = require("googleapis");
const { createLogger, format, transports} = require("winston")

const app = express();

// Middleware
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

// Middleware
// app.use(
//   cookieSession({
//     name: "session",
//     keys: [process.env.SESSION_SECRET || "default_secret_key"],
//     maxAge: 24 * 60 * 60 * 1000, // 24 hours
//   })
// );
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
    <h1>Welcome to Google Auth App</h1>
    ${req.isAuthenticated() ? `<p>Hello, ${req.user.profile.displayName}</p>` : `<a href="/auth/google">Login with Google</a>`}
    ${req.isAuthenticated() ? `<a href="/logout">Logout</a>` : ""}
    ${req.isAuthenticated() ? `<a href="/drive">View Google Drive Files</a>` : ""}
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
