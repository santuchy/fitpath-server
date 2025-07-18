const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

// Load env variable from .env file
dotenv.config();

const app = express();
const port = process.env.port || 3000;

// middleware
app.use(cors());
app.use(express.json());


// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount)
// });





const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@programmingprojects.a8aga1n.mongodb.net/?retryWrites=true&w=majority&appName=ProgrammingProjects`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});


// Verify Firebase Token Middleware

// const verifyToken = async (req, res, next) => {
//   const authHeader = req.headers.authorization;
//   if (!authHeader) return res.status(401).send({ error: 'Unauthorized access' });

//   const token = authHeader.split(' ')[1];
//   try {
//     const decoded = await admin.auth().verifyIdToken(token);
//     req.user = decoded;
//     next();
//   } catch (error) {
//     res.status(403).send({ error: 'Forbidden access' });
//   }
// };




async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const db = client.db("fitPathDB");
        const usersCollection = db.collection("users");
        const classesCollection = db.collection("classes");
        const slotsCollection = db.collection("slots");

        // 🔎 Get a single trainer by ID
        app.get('/trainers/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const trainer = await usersCollection.findOne(query);
            res.send(trainer);
        });


        // 🔎 Get slots by trainer email
        app.get('/slots/trainer/:email', async (req, res) => {
            const email = req.params.email;
            const query = { trainerEmail: email };
            const result = await slotsCollection.find(query).toArray();
            res.send(result);
        });

        // 🔎 Get all trainers
        app.get('/trainers', async (req, res) => {
            const query = { role: 'trainer' };
            const trainers = await usersCollection.find(query).toArray();
            res.send(trainers);
        });

        // GET: All slots for a specific trainer by email
        app.get('/slots', async (req, res) => {
            const email = req.query.email;
            const query = { email };
            const result = await slotsCollection.find(query).toArray();
            res.send(result);
        });

        // DELETE: Slot by ID
        app.delete('/slots/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await slotsCollection.deleteOne(query);
            res.send(result);
        });

        // GET all classes
        app.get('/classes', async (req, res) => {
            const result = await classesCollection.find().toArray();
            res.send(result);
        });

        // POST: Save a new slot
        app.post('/slots', async (req, res) => {
            const slotData = req.body;
            const result = await slotsCollection.insertOne(slotData);
            res.send(result);
        });

        // POST new class
        app.post('/classes', async (req, res) => {
            const classData = req.body;
            classData.totalBookings = 0;
            const result = await classesCollection.insertOne(classData);
            res.send(result);
        });

        // 🧑‍💼 Save user
        app.post('/users', async (req, res) => {
            const user = req.body;

            // Check if user already exists by email
            const query = { email: user.email };
            const exists = await usersCollection.findOne(query);

            if (exists) {
                return res.send({ message: 'User already exists' });
            }

            const result = await usersCollection.insertOne(user);
            res.send(result);
        });

        // 🧑‍💼 Get all users
        app.get('/users', async (req, res) => {
            const users = await usersCollection.find().toArray();
            res.send(users);
        });


        // Save user to DB
        app.post('/users', async (req, res) => {
            const user = req.body;
            const query = { email: user.email };
            const exists = await usersCollection.findOne(query);
            if (exists) return res.send({ message: 'User already exists' });

            const result = await usersCollection.insertOne(user);
            res.send(result);
        });

        // Get all users (admin only)
        app.get('/users', async (req, res) => {
            const users = await usersCollection.find().toArray();
            res.send(users);
        });

        // Secure API test
        app.get('/secure-data', (req, res) => {
            res.send({ message: `Welcome, ${req.user.email}` });
        });





        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


// sample route
app.get('/', (req, res) => {
    res.send('FitPath Server is running');
});

// start server
app.listen(port, () => {
    console.log(`Server is listening on port ${port}`);
});