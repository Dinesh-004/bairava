const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const twilio = require('twilio');
const Razorpay = require('razorpay');

require('dotenv').config();

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

const db = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  port: process.env.MYSQL_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

db.getConnection((err, connection) => {
  if (err) {
    console.error('❌ Database connection error:', err);
  } else {
    console.log('✅ Connected to MySQL');
    connection.release();
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});


// const accountSid = 'ACb7d1489c18ec07b92a5b9b66ba8c374d';//AC2386df8e3b1afeae7dad935f23b51ab0
// const authToken = '9d93622fc3fcd009999d433fe19f7776';//76b1d1984df91680aa99a778653fc462
// const twilioNumber = '+16085935230';//+12178035187

const accountSid = process.env.TWILIO_SID;
const authToken = process.env.TWILIO_TOKEN;
const twilioNumber = process.env.TWILIO_NUMBER;

const client = twilio(accountSid, authToken);

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Middleware
app.use(cors());
app.use(express.json());

// Temporary in-memory store (for demo only)
const otpStore = {};                  // { "mobileNumber": "1234" }
const registeredMobiles = new Set(); // [ "9876543210" ]




//SEND OTP
app.post('/send-otp', async (req, res) => {
  const { mobileNumber } = req.body;

  if (!mobileNumber) {
    return res.status(400).json({ success: false, message: 'Mobile number required' });
  }

  const otp = Math.floor(1000 + Math.random() * 9000).toString(); // 4-digit OTP
  console.log(`Generated OTP for ${mobileNumber}: ${otp}`);

  try {
    await client.messages.create({
      body: `Your OTP is: ${otp}`,
      from: twilioNumber,
      to: `+91${mobileNumber}`
    });

    otpStore[mobileNumber] = otp;
    res.json({ success: true, message: 'OTP sent successfully' });
  } catch (error) {
    console.error('Twilio Error:', error);
    res.status(500).json({ success: false, message: 'Failed to send OTP', error: error.message });
  }
});

//Verify OTP
app.post('/verify-otp', (req, res) => {
  const { mobileNumber, otp } = req.body;

  if (!mobileNumber || !otp) {
    return res.status(400).json({ success: false, message: 'Mobile number and OTP required' });
  }

  if (otpStore[mobileNumber] === otp) {
    delete otpStore[mobileNumber]; // Clear OTP
    console.log(`Otp verified`);
    return res.json({ success: true, message: 'OTP verified successfully' });
  }
  console.log(otp);
  console.log(`Invalid Otp`);
  return res.status(400).json({ success: false, message: 'Invalid OTP' });
});

app.delete('/delete-pending-users', (req, res) => {
  const deleteQuery = `DELETE FROM user_details WHERE LOWER(TRIM(status)) = 'pending'`;

  db.query(deleteQuery, (deleteErr, deleteResult) => {  
    if (deleteErr) {
      console.error('❌ Delete error:', deleteErr);
      return res.status(500).json({ success: false, message: 'Database error while deleting pending users' });
    }

    console.log(`🗑️ Deleted ${deleteResult.affectedRows} pending users`);

    return res.status(200).json({
      success: true,
      message: `${deleteResult.affectedRows} pending users deleted successfully`
    });
  });
});

// ✅ POST: Store mobile number
app.post('/store-mobile', (req, res) => {
  const { mobileNumber } = req.body;

  if (!mobileNumber) {
    return res.status(400).json({ success: false, message: 'Mobile number is required' });
  }

  const checkQuery = `SELECT * FROM user_details WHERE mobile_number = ?`;
  db.query(checkQuery, [mobileNumber], (checkErr, results) => {
    if (checkErr) {
      console.error('❌ Check error:', checkErr);
      return res.status(500).json({ success: false, message: 'Database check error' });
    }

    if (results.length > 0) {
      return res.status(200).json({
        success: false,
        message: 'Mobile number already exists. Please login.',
        userExists: true
      });
    }
 
    const insertQuery = `INSERT INTO user_details (mobile_number, status) VALUES (?, 'pending')`;
    db.query(insertQuery, [mobileNumber], (insertErr) => {
      if (insertErr) {
        console.error('❌ Insert error:', insertErr);
        return res.status(500).json({ success: false, message: 'Insert error' });
      }

      return res.status(200).json({
        success: true,
        message: 'Mobile number stored successfully'
      });
    });
  });
});


// ✅ 2. Update User Details
app.post('/store-user-details', (req, res) => {
  const {
    fullName,
    email,
    mobileNumber,
    username,
    password,
  } = req.body;

  const sql = `
  INSERT INTO user_details (
    full_name, 
    email, 
    mobile_number, 
    username,
    password
  ) VALUES (?, ?, ?, ?, ?)
`;


  const values = [
    fullName,
    email,
    mobileNumber,
    username,
    password,
  ];

  db.query(sql, values, (err, result) => {
    if (err) {
      console.error('❌ Update Error:', err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Failed to update user details' });
    }

    res.json({ success: true, message: 'User details updated successfully' });
  });
});

// ✅ 3. Set Security PIN (Plain Text Storage)
app.post('/set-security-pin', (req, res) => {
  const { mobileNumber, pin, deviceId} = req.body;

  if (!mobileNumber || !pin || !deviceId) {
    return res.status(400).json({ success: false, message: 'Mobile number, PIN, and device ID are required' });
  }

  const sql = `UPDATE user_details SET security_pin = ?, status = 'completed', device_id = ? WHERE mobile_number = ?`;

  db.query(sql, [pin, deviceId, mobileNumber], (err, result) => {
    if (err) {
      console.error('❌ PIN update error:', err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Mobile number not found' });
    }

    res.json({ success: true, message: 'Security PIN saved successfully (plain text)' });
  });
});


app.post('/get-sessions', (req, res) => {
  const { deviceId } = req.body;

  if (!deviceId) {
    return res.status(400).json({ success: false, message: 'Missing deviceId' });
  }

  const sql = `SELECT * FROM session_details WHERE device_id = ? ORDER BY session_date DESC`;

  db.query(sql, [deviceId], (err, results) => {
    if (err) {
      console.error('❌ Error fetching sessions:', err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    res.json({ success: true, sessions: results });
  });
});



app.post('/get-user-details', (req, res) => {
  const { deviceId } = req.body;

  if (!deviceId) {
    return res.status(400).json({ success: false, message: 'Device ID is required' });
  }

  const sql = `SELECT full_name, mobile_number FROM user_details WHERE device_id = ?`;

  db.query(sql, [deviceId], (err, results) => {
    if (err) {
      console.error('❌ Database error:', err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    if (results.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, user: results[0] });
  });
});


app.post('/update-user-name', (req, res) => {
  const { deviceId, fullName } = req.body;

  if (!deviceId || !fullName) {
    return res.status(400).json({ success: false, message: 'Device ID and full name are required' });
  }

  const sql = `UPDATE user_details SET full_name = ? WHERE device_id = ?`;

  db.query(sql, [fullName, deviceId], (err, result) => {
    if (err) {
      console.error('❌ Database error:', err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, message: 'Name updated successfully' });
  });
});

app.post('/update-profile-image', (req, res) => {
  const { deviceId, imageBase64 } = req.body;

  if (!deviceId || !imageBase64) {
    return res.status(400).json({ success: false, message: 'Missing deviceId or imageBase64' });
  }

  const sql = `UPDATE user_details SET profile_image = ? WHERE device_id = ?`;

  db.query(sql, [imageBase64, deviceId], (err, result) => {
    if (err) {
      console.error('❌ Error updating profile image:', err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, message: 'Profile image updated' });
  });
});

app.post('/get-profile-image', (req, res) => {
  const { deviceId } = req.body;

  if (!deviceId) {
    return res.status(400).json({ success: false, message: 'Device ID required' });
  }

  const sql = `SELECT profile_image FROM user_details WHERE device_id = ?`;

  db.query(sql, [deviceId], (err, results) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    if (results.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, imageBase64: results[0].profile_image });
  });
});

// Change Password Route
app.post('/api/change-password', (req, res) => {
  const { email, oldPassword, newPassword } = req.body;

  if (!email || !oldPassword || !newPassword) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  const checkUserQuery = 'SELECT * FROM admin_users WHERE email = ?';
  db.query(checkUserQuery, [email], (err, results) => {
    if (err) return res.status(500).json({ message: 'Database error' });
    if (results.length === 0) return res.status(404).json({ message: 'Admin not found' });

    const admin = results[0];
    if (admin.password !== oldPassword) {
      return res.status(401).json({ message: 'Incorrect old password' });
    }

    const updateQuery = 'UPDATE admin_users SET password = ? WHERE email = ?';
    db.query(updateQuery, [newPassword, email], (updateErr) => {
      if (updateErr) return res.status(500).json({ message: 'Update failed' });
      res.json({ message: 'Password changed successfully' });
    });
  });
});


//security pin
  app.post('/api/verify-pin', (req, res) => {
    const { deviceId, securityPIN } = req.body;

    if (!deviceId || !securityPIN) {
      return res.status(400).json({ success: false, message: 'Id and PIN required' });
    }

    const query = 'SELECT security_pin FROM user_details WHERE device_Id = ?';
    console.log(deviceId);
    db.query(query, [deviceId], (err, results) => {
      if (err) {
        console.error('DB error:', err);
        return res.status(500).json({ success: false, message: 'Database error' });
      }

      if (results.length === 0) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      const storedPin = results[0].security_pin;
      if (securityPIN === storedPin) {
        return res.json({ success: true, message: 'PIN verified' });
      } else {
        return res.json({ success: false, message: 'Incorrect PIN' });
      }
    });
  });

// app.post('/verify-pin', (req, res) => {
//   const { securityPIN } = req.body;

//   if (!securityPIN) {
//     return res.status(400).json({ success: false, message: 'PIN required' });
//   }

//   const query = 'SELECT mobile_number FROM user_details WHERE security_pin = ?';
//   db.query(query, [securityPIN], (err, results) => {
//     if (err) {
//       console.error('DB error:', err);
//       return res.status(500).json({ success: false, message: 'Database error' });
//     }

//     if (results.length === 0) {
//       return res.status(404).json({ success: false, message: 'Incorrect PIN' });
//     }

//     // Optionally, you can return the mobile number or just success
//     return res.json({ success: true, message: 'PIN verified', mobileNumber: results[0].mobile_number });
//   });
// });

app.post('/reset-pin', (req, res) => {
  const { mobileNumber, newPin } = req.body;

    const updateQuery = 'UPDATE user_details SET security_pin = ? WHERE mobile_number = ?';
    db.query(updateQuery, [newPin, mobileNumber], (err, result) => {
      if (err) {
        console.error('PIN update error:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
      }
    res.json({ success: true, message: 'PIN reset successfully' });
  });
});