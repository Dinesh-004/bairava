const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const twilio = require('twilio');
const Razorpay = require('razorpay');
const crypto = require("crypto");


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

app.get('/', (req, res) => {
  res.send('Hello, World!');
});


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

// Set Password
app.post('/set-password', (req, res) => {
  const { mobileNumber, password} = req.body;

  if (!mobileNumber || !password) {
    return res.status(400).json({ success: false, message: 'Mobile number, and password required' });
  }

  const sql = `UPDATE user_details SET password = ? WHERE mobile_number = ?`;

  db.query(sql, [password, mobileNumber], (err, result) => {
    if (err) {
      console.error('❌ PIN update error:', err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Mobile number not found' });
    }

    res.json({ success: true, message: 'Password saved successfully' });
  });
});

app.post('/check-mobile', (req, res) => {
  const { mobileNumber } = req.body;

  if (!mobileNumber) {
    return res.status(400).json({ success: false, message: 'Mobile number required' });
  }

  const query = 'SELECT * FROM user_details WHERE mobile_number = ?';
  db.query(query, [mobileNumber], (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    if (results.length > 0) {
      return res.json({ success: true, exists: true, message: 'Mobile number found' });
    } else {
      return res.json({ success: true, exists: false, message: 'Mobile number not found' });
    }
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


//security password
  app.post('/verify-user', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required' });
  }

  const query = 'SELECT password FROM user_details WHERE username = ?';

  db.query(query, [username], (err, results) => {
    if (err) {
      console.error('❌ DB error:', err);
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    if (results.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const storedPassword = results[0].password;
    if (password === storedPassword) {
      return res.json({ success: true, message: 'User verified successfully' });
    } else {
      return res.json({ success: false, message: 'Incorrect password' });
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

app.get('/products', (req, res) => {
  const sql = 'SELECT * FROM products';
  db.query(sql, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

app.post('/update-profile-image', (req, res) => {
  const { username, imageBase64 } = req.body;

  if (!username || !imageBase64) {
    return res.status(400).json({ success: false, message: 'Missing username or imageBase64' });
  }

  const sql = `UPDATE user_details SET profile_image = ? WHERE username = ?`;

  db.query(sql, [imageBase64, username], (err, result) => {
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
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ success: false, message: 'username required' });
  }

  const sql = `SELECT profile_image FROM user_details WHERE username = ?`;

  db.query(sql, [username], (err, results) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    if (results.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, imageBase64: results[0].profile_image });
  });
});

app.post('/update-fullname', (req, res) => {
  const { fullname, username } = req.body;

  if (!fullname || !username) {
    return res.status(400).json({
      success: false,
      message: 'username and fullname are required'
    });
  }

    const updateSql = `UPDATE user_details SET full_name = ? WHERE username = ?`;
    db.query(updateSql, [fullname, username], (err, result) => {
      if (err) {
        console.error('❌ Database error:', err);
        return res.status(500).json({
          success: false,
          message: 'Database error'
        });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      res.json({
        success: true,
        message: 'Name updated successfully'
      });
    });
  });

app.post('/get-user-details', (req, res) => {
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ success: false, message: 'username is required' });
  }

  const sql = `SELECT full_name, mobile_number, email FROM user_details WHERE username = ?`;

  db.query(sql, [username], (err, results) => {
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

app.post("/update-appointments", (req, res) => {
  const {
    name,
    gender,
    appointment_date,
    appointment_time,
    breed,
    color,
    weight,
    description,
    status,
    username
  } = req.body;

  const sql = `INSERT INTO appointments 
    (name, gender, appointment_date, appointment_time, breed, color, weight, description, status, username) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  db.query(
    sql,
    [name, gender, appointment_date, appointment_time, breed, color, weight, description, status, username],
    (err, result) => {
      if (err) {
        console.error("❌ Error inserting data:", err);
        return res.status(500).json({ error: "Database error" });
      }
      res.json({ message: "✅ Appointment booked successfully", appointmentId: result.insertId });
    }
  );
});


app.get("/get-appointments", (req, res) => {
  const { username } = req.query;

  if (!username) {
    return res.status(400).json({ error: "Username is required" });
  }

  db.query(
    "SELECT * FROM appointments WHERE username = ? ORDER BY created_at DESC",
    [username],
    (err, results) => {
      if (err) {
        console.error("❌ Error fetching data:", err);
        return res.status(500).json({ error: "Database error" });
      }

      if (results.length === 0) {
        return res.status(404).json({ message: "No appointments found for this user" });
      }

      res.json(results);
    }
  );
});


app.get("/check-username", (req, res) => {
  const username = req.query.username;

  db.query(
    "SELECT COUNT(*) AS count FROM user_details WHERE username = ?",
    [username],
    (err, results) => {
      if (err) return res.status(500).json({ error: err.message });

      if (results[0].count > 0) {
        res.json({ exists: true });
      } else {
        res.json({ exists: false });
      }
    }
  );
});

app.post("/change-password", (req, res) => {
  const { username, currentPassword, newPassword } = req.body;

  if (!username || !currentPassword || !newPassword) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  db.query(
    "SELECT * FROM user_details WHERE username = ?",
    [username],
    (err, results) => {
      if (err) return res.status(500).json({ error: err });
      if (results.length === 0) {
        return res.status(404).json({ message: "User not found" });
      }

      const user = results[0];

      if (user.password !== currentPassword) {
        return res.status(401).json({ message: "Current password is incorrect" });
      }

      db.query(
        "UPDATE user_details SET password = ? WHERE username = ?",
        [newPassword, username],
        (err) => {
          if (err) return res.status(500).json({ error: err });
          return res.json({ message: "Password updated successfully" });
        }
      );
    }
  );
});

app.post('/api/save-order', (req, res) => {
  const { products, address, paymentMethod, total, username } = req.body;

  if (!Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ success: false, message: 'No products provided' });
  }

  const orderQuery = `
    INSERT INTO orders (address, payment_method, total, username)
    VALUES (?, ?, ?, ?)
  `;
  db.query(orderQuery, [address, paymentMethod, total, username], (orderErr, orderResult) => {
    if (orderErr) {
      console.error('Order insert error:', orderErr);
      return res.status(500).json({ success: false, message: 'Server error (orders)' });
    }

    const orderId = orderResult.insertId;
    const itemValues = products.map(product => [
      orderId,
      product.id,
      product.title,
      product.unitPrice,
      product.quantity,
      product.lineTotal
    ]);

    const itemsQuery = `
      INSERT INTO order_items
      (order_id, product_id, title, unit_price, quantity, line_total)
      VALUES ?
    `;

    db.query(itemsQuery, [itemValues], (itemsErr, itemsResult) => {
      if (itemsErr) {
        console.error('Order items insert error:', itemsErr);
        return res.status(500).json({ success: false, message: 'Server error (order_items)' });
      }

      res.json({ success: true, message: 'Order saved successfully', orderId });
    });
  });
});

app.post('/orders', (req, res) => {
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ error: 'username is required' });
  }

  const orderQuery = 'SELECT * FROM orders WHERE username = ? ORDER BY created_at DESC';
  const itemsQuery = 'SELECT * FROM order_items';

  db.query(orderQuery, [username], (err, orders) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch orders' });
    }

    db.query(itemsQuery, (err, items) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to fetch order items' });
      }

      const result = orders.map((order) => {
        const orderItems = items.filter((item) => item.order_id === order.order_id);
        return { ...order, items: orderItems };
      });

      res.json(result);
    });
  });
});

// API to get all pets
app.get("/pets", (req, res) => {
  db.query("SELECT * FROM pets", (err, results) => {
    if (err) {
      res.status(500).json({ error: err });
    } else {
      res.json(results);
    }
  });
});

// API to add new pet
app.post("/pets", (req, res) => {
  const { name, breed, gender,age, weight, color, image } = req.body;
  db.query(
    "INSERT INTO pets (name, breed, gender, age, weight, color, image) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [name, breed, gender, age, weight, color, image || null],
    (err, results) => {
      if (err) {
        res.status(500).json({ error: err });
      } else {
        res.json({ message: "Pet added successfully!" });
      }
    }
  );
});

// API to update pet
app.put("/pets/:id", (req, res) => {
  const { id } = req.params;
  const { name, breed, gender, age, weight, color, image } = req.body;
  db.query(
    "UPDATE pets SET name=?, breed=?, gender=?, age=?, weight=?, color=?, image=? WHERE id=?",
    [name, breed, gender, age, weight, color, image, id],
    (err, results) => {
      if (err) {
        res.status(500).json({ error: err });
      } else {
        res.json({ message: "Pet updated successfully!" });
      }
    }
  );
});

// Delete pet
app.delete("/delete-pet/:id", (req, res) => {
  const { id } = req.params;
  db.query("DELETE FROM pets WHERE id = ?", [id], (err, result) => {
    if (err) {
      console.error(err);
      res.status(500).send("Error deleting pet");
    } else if (result.affectedRows === 0) {
      res.status(404).send("Pet not found");
    } else {
      res.json({ message: "Pet deleted successfully" });
    }
  });
});

// Create payment order endpoint
app.post('/create-order', async (req, res) => {
  const { amount, currency = 'INR', receipt = 'receipt_001' } = req.body;

  try {
    const order = await razorpay.orders.create({
      amount: amount * 100, // Amount in paise
      currency,
      receipt,
    });

    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verify payment signature endpoint
app.post('/verify-payment', (req, res) => {
  const { order_id, payment_id, signature } = req.body;

  const hmac = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET);
  hmac.update(`${order_id}|${payment_id}`);
  const digest = hmac.digest('hex');

  if (digest === signature) {
    res.json({ success: true });
  } else {
    res.status(400).json({ success: false, message: 'Signature verification failed' });
  }
});

app.get("/payment/:id", async (req, res) => {
  try {
    const payment = await razorpay.payments.fetch(req.params.id);
    res.json(payment);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/adopt-pet", (req, res) => {
  db.query("SELECT * FROM adoptions", (err, results) => {
    if (err) {
      res.status(500).json({ error: err });
    } else {
      res.json(results);
    }
  });
});

// Save hotel booking
app.post("/save-hotel-booking", (req, res) => {
  const { username, roomType, checkInDate, checkOutDate, paymentMethod, price } = req.body;

  if (!username || !roomType || !checkInDate || !checkOutDate || !price) {
    return res.status(400).json({ success: false, message: "Missing required fields" });
  }

  db.query(
    "INSERT INTO hotel_bookings (username, roomType, checkInDate, checkOutDate, paymentMethod, price) VALUES (?, ?, ?, ?, ?, ?)",
    [username, roomType, checkInDate, checkOutDate, paymentMethod, price],
    (err, results) => {
      if (err) {
        console.error("❌ Error saving booking:", err);
        return res.status(500).json({ success: false, message: "Database error", error: err });
      }
      res.json({ success: true, message: "Booking saved successfully!" });
    }
  );
});

app.get("/get-hotel-bookings/:username", (req, res) => {
  const { username } = req.params;
  db.query(
    "SELECT * FROM hotel_bookings WHERE username = ? ORDER BY checkInDate DESC",
    [username],
    (err, results) => {
      if (err) {
        console.error("❌ Error fetching bookings:", err);
        return res.status(500).json({ success: false, message: "Database error" });
      }
      res.json({ success: true, bookings: results });
    }
  );
});

// POST /add-review
app.post("/add-review", (req, res) => {
  const { productId, user, rating, comment } = req.body;

  if (!productId || !user || !rating) {
    return res.json({ success: false, message: "Missing fields" });
  }

  const sql =
    "INSERT INTO product_reviews (productId, username, rating, comment) VALUES (?, ?, ?, ?)";
  db.query(sql, [productId, user, rating, comment], (err, result) => {
    if (err) {
      console.error("❌ Error inserting review:", err);
      return res
        .status(500)
        .json({ success: false, message: "Database error" });
    }

    res.json({
      success: true,
      message: "Review added",
      review: {
        id: result.insertId,
        productId,
        user,
        rating,
        comment,
        date: new Date().toISOString().slice(0, 10),
      },
    });
  });
});

// GET /get-reviews/:productId
app.get("/get-reviews/:productId", (req, res) => {
  const { productId } = req.params;

  const sql =
    "SELECT id, productId, username AS user, rating, comment, date FROM product_reviews WHERE productId = ? ORDER BY date DESC";
  db.query(sql, [productId], (err, results) => {
    if (err) {
      console.error("❌ Error fetching reviews:", err);
      return res
        .status(500)
        .json({ success: false, message: "Database error" });
    }

    res.json({ success: true, reviews: results });
  });
});
