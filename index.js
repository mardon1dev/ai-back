// Barcha kerakli modullarni yuklab olish
const express = require("express");
const bodyParser = require("body-parser");
const http = require("http");
const { Server } = require("socket.io");
const twilio = require("twilio");
const mongoose = require("mongoose");

// Loyihaning muhim ma'lumotlari (Environment Variables orqali olinishi tavsiya etiladi)
const accountSid = "YOUR_TWILIO_ACCOUNT_SID";
const authToken = "YOUR_TWILIO_AUTH_TOKEN";
const twilioPhoneNumber = "YOUR_TWILIO_PHONE_NUMBER"; // Masalan, +15017122661

// Twilio mijozini yaratish
const twilioClient = twilio(accountSid, authToken);

// Express ilovasini va serverni sozlash
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Frontend'dan kirishga ruxsat berish
    methods: ["GET", "POST"],
  },
});
const PORT = process.env.PORT || 3000;

// Body-parser sozlamalari (Twilio'dan kelgan ma'lumotlarni o'qish uchun)
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// MongoDB'ga ulanish
// Twilio va log ma'lumotlari uchun MongoDB schemasi yaratiladi
const LeadSchema = new mongoose.Schema({
  phoneNumber: String,
  callStatus: String, // 'initiated', 'in-progress', 'completed', 'failed', 'no-answer'
  salesAgent: { type: String, default: null },
  callSid: String, // Twilio'ning unikal qo'ng'iroq ID'si
  transferedToAgent: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});
const Lead = mongoose.model("Lead", LeadSchema);

mongoose
  .connect(
    "mongodb+srv://dusbekovmardonbek5430:<jA5w5MYqBLolsZ0A>@cluster0.6llpabh.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0",
    {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    }
  )
  .then(() => {
    console.log("MongoDB'ga muvaffaqiyatli ulandi.");
  })
  .catch((err) => {
    console.error("MongoDB'ga ulanishda xato:", err);
  });

// =========================================================================
// ASOSIY API ENDPOINTS
// =========================================================================

// MVP: Lidga qo'ng'iroq qilishni boshlash uchun API
// Frontend ushbu API'ga `phoneNumber` bilan murojaat qiladi
app.post("/call-lead", async (req, res) => {
  const { phoneNumber } = req.body;
  if (!phoneNumber) {
    return res.status(400).send("Telefon raqami talab qilinadi.");
  }

  try {
    // Yangi lid ma'lumotlarini MongoDB'ga saqlash
    const newLead = new Lead({
      phoneNumber: phoneNumber,
      callStatus: "initiated",
    });
    await newLead.save();

    // Twilio orqali qo'ng'iroqni boshlash
    const call = await twilioClient.calls.create({
      to: phoneNumber,
      from: twilioPhoneNumber,
      // Twilio'dan qo'ng'iroq holati haqida ma'lumot olish uchun webhook URL'i
      statusCallback: "http://your-ngrok-url.com/twilio-status",
      statusCallbackEvent: ["answered", "completed", "no-answer", "failed"],
      // Javob berilsa, ushbu URL'ga yo'naltiriladi
      url: "http://your-ngrok-url.com/connect-to-agent",
    });

    // MongoDB'da qo'ng'iroq SID'ini saqlash
    newLead.callSid = call.sid;
    await newLead.save();

    console.log(`Qo'ng'iroq boshlandi, Call SID: ${call.sid}`);
    res.status(200).send({
      message: "Qo'ng'iroq muvaffaqiyatli boshlandi.",
      callSid: call.sid,
    });
  } catch (error) {
    console.error("Qo'ng'iroq qilishda xato:", error);
    res.status(500).send({ error: "Qo'ng'iroq qilishda xato yuz berdi." });
  }
});

// MVP: Twilio'dan keladigan status yangilanishlarini qabul qilish uchun webhook
// Bu endopointga Twilio avtomatik ravishda qo'ng'iroq qiladi
app.post("/twilio-status", async (req, res) => {
  const callSid = req.body.CallSid;
  const callStatus = req.body.CallStatus;

  try {
    const lead = await Lead.findOneAndUpdate(
      { callSid: callSid },
      { callStatus: callStatus },
      { new: true }
    );

    if (lead) {
      console.log(`Qo'ng'iroq holati yangilandi: ${callStatus}`);
      // Frontend'ga real-time yangilanish yuborish
      io.emit("call-status-update", { callSid: callSid, status: callStatus });
    }
  } catch (error) {
    console.error("Qo'ng'iroq holatini yangilashda xato:", error);
  }
  res.status(200).send(); // Twilio'ga muvaffaqiyatli javob qaytarish
});

// MVP: Javob berilgan qo'ng'iroqni sotuvchiga ulash uchun TwiML webhook'i
// Bu endpoint Twilio Call's `url` parameteriga mos kelishi kerak.
app.post("/connect-to-agent", (req, res) => {
  const twiml = new twilio.Twiml.VoiceResponse();
  // Bu qismda sotuvchining raqami aniqlanadi (masalan, bazadan olinadi)
  const agentPhoneNumber = "+99890XXXXXX"; // Sotuvchining raqami

  // <Dial> bilan qo'ng'iroqni sotuvchiga ulash
  twiml.dial(agentPhoneNumber);

  res.type("text/xml");
  res.send(twiml.toString());
});

// =========================================================================
// REAL-TIME WEBSOCKET ULANISHI
// =========================================================================

io.on("connection", (socket) => {
  console.log("Yangi foydalanuvchi ulandi:", socket.id);

  socket.on("disconnect", () => {
    console.log("Foydalanuvchi uzildi:", socket.id);
  });

  // Bu yerga boshqa real-time funksiyalarni qo'shishingiz mumkin
});

// Serverni ishga tushirish
server.listen(PORT, () => {
  console.log(`Server ${PORT}-portda ishga tushdi`);
});
