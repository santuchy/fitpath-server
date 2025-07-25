const dotenv = require('dotenv');
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

// Load env variable from .env file
dotenv.config();

const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY);



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
        const appliedTrainersCollection = db.collection("appliedTrainers");
        const rejectedTrainersCollection = db.collection("rejectedTrainers");
        const paymentsCollection = db.collection("payments");
        const reviewsCollection = db.collection("reviews");
        const newsletterCollection = db.collection("newsletter");


        // get and post api for newsletter
        app.post("/newsletter-subscribe", async (req, res) => {
            const { name, email } = req.body;
            if (!name || !email) {
                return res.status(400).json({ message: "Name and email are required" });
            }

            try {
                await newsletterCollection.insertOne({ name, email, subscribedAt: new Date() });
                res.status(200).json({ message: "Subscribed successfully" });
            } catch (err) {
                console.error("Newsletter subscription failed:", err);
                res.status(500).json({ message: "Server error" });
            }
        });

        app.get("/newsletter-subscribers", async (req, res) => {
            try {
                const allSubscribers = await newsletterCollection.find().toArray();
                res.json(allSubscribers);
            } catch (err) {
                res.status(500).json({ message: "Failed to fetch subscribers" });
            }
        });

        // GET user’s trainer application statuses (pending + rejected)
        app.get('/my-applications/:email', async (req, res) => {
            const { email } = req.params;

            try {
                const applied = await appliedTrainersCollection.find({ email }).toArray();
                const rejected = await rejectedTrainersCollection.find({ email }).toArray();

                const formattedApplied = applied.map(app => ({
                    name: app.name,
                    email: app.email,
                    status: "Pending",
                }));

                const formattedRejected = rejected.map(app => ({
                    name: app.name,
                    email: app.email,
                    status: "Rejected",
                    message: app.feedback || "No feedback provided",
                }));

                const combined = [...formattedApplied, ...formattedRejected];

                res.send(combined);
            } catch (error) {
                console.error("Error fetching applications:", error);
                res.status(500).send({ message: "Server error" });
            }
        });





        // booked trainer get api
        app.get("/booked-trainers/:email", async (req, res) => {
            try {
                const email = req.params.email;
                const payments = await paymentsCollection.find({ userEmail: email }).toArray();
                res.send(payments);
            } catch (err) {
                console.error(err);
                res.status(500).send({ error: "Failed to fetch booked trainers" });
            }
        });


        // Get all reviews (for homepage testimonial slider)
        app.get('/reviews', async (req, res) => {
            try {
                const reviews = await reviewsCollection
                    .find({})
                    .sort({ createdAt: -1 })
                    .toArray();
                res.send(reviews);
            } catch (error) {
                console.error("Error fetching reviews:", error);
                res.status(500).json({ error: "Failed to fetch reviews" });
            }
        });

        // Save review to DB
        app.post('/reviews', async (req, res) => {
            const review = req.body;
            try {
                const result = await reviewsCollection.insertOne(review);
                res.send({ insertedId: result.insertedId });
            } catch (error) {
                console.error("Error saving review:", error);
                res.status(500).json({ error: "Failed to save review" });
            }
        });



        // Payment Save API
        app.post("/payments", async (req, res) => {
            try {
                const payment = req.body;

                // Save payment in DB
                const insertResult = await paymentsCollection.insertOne(payment);

                // Update booking count in the class
                const classUpdate = await classesCollection.updateOne(
                    { name: payment.className },
                    { $inc: { bookingCount: 1 } }
                );

                res.send({
                    success: true,
                    insertedId: insertResult.insertedId,
                    classUpdated: classUpdate.modifiedCount > 0,
                });
            } catch (error) {
                console.error("Error in /payments:", error);
                res.status(500).send({ success: false, message: "Payment failed to save" });
            }
        });




        // payment intent for stripe integration
        app.post('/create-payment-intent', async (req, res) => {
            const { slotId, package: packageType } = req.body;

            let amount = 1000;
            if (packageType === "standard") amount = 5000;
            if (packageType === "premium") amount = 10000;

            try {
                const paymentIntent = await stripe.paymentIntents.create({
                    amount,
                    currency: 'usd',
                    payment_method_types: ['card'],
                });

                res.send({ clientSecret: paymentIntent.client_secret });
            } catch (err) {
                console.error("Stripe error:", err);
                res.status(500).send({ error: err.message });
            }
        });



        // GET all available slots
        app.get('/available-slots', async (req, res) => {
            try {
                const availableSlots = await slotsCollection.find({ isAvailable: true }).toArray();

                if (!availableSlots.length) {
                    return res.status(404).json({ message: "No available slots found" });
                }

                res.json(availableSlots);
            } catch (error) {
                console.error("Error fetching available slots:", error);
                res.status(500).json({ message: "Failed to fetch available slots" });
            }
        });









        // Route to handle slot booking and membership selection
        app.post('/book-slot', async (req, res) => {
            const { trainerId, slotId, userId, selectedPackage } = req.body;

            try {
                // Fetch the trainer's info from the users collection
                const trainer = await usersCollection.findOne({ _id: new ObjectId(trainerId) });

                if (!trainer || trainer.role !== 'trainer') {
                    return res.status(404).json({ message: 'Trainer not found or not a trainer' });
                }

                // Fetch the slot info
                const slot = await slotsCollection.findOne({ _id: new ObjectId(slotId) });
                if (!slot) {
                    return res.status(404).json({ message: 'Slot not found' });
                }

                // Save the booking information to the bookings collection
                const booking = {
                    trainerId,
                    slotId,
                    userId,
                    selectedPackage,
                    bookingStatus: 'pending', // Set booking status to pending until payment is completed
                    bookingTime: new Date(),
                };

                const result = await bookingsCollection.insertOne(booking);

                // Send a success response with booking info
                res.status(201).json({ message: 'Slot booked successfully', bookingId: result.insertedId });
            } catch (error) {
                console.error('Error booking slot:', error);
                res.status(500).json({ message: 'Failed to book slot. Please try again.' });
            }
        });



        // Get a specific slot by ID
        app.get('/slots/:id', async (req, res) => {
            const { id } = req.params;

            // 🔒 Validate ObjectId
            if (!ObjectId.isValid(id)) {
                return res.status(400).json({ message: "Invalid slot ID format" });
            }

            try {
                const slot = await slotsCollection.findOne({ _id: new ObjectId(id) });

                if (!slot) {
                    return res.status(404).send({ message: 'Slot not found' });
                }

                res.send(slot);
            } catch (error) {
                console.error("Error fetching slot by ID:", error);
                res.status(500).json({ message: "Server error while fetching slot" });
            }
        });



        // Get trainer info by email
        app.get('/trainers/:email', async (req, res) => {
            const { email } = req.params;
            const trainer = await usersCollection.findOne({ email });
            if (!trainer) {
                return res.status(404).send({ message: 'Trainer not found' });
            }
            res.send(trainer);
        });

        // Increment the slot booking count
        app.patch('/slots/book/:id', async (req, res) => {
            const { id } = req.params;
            const updatedSlot = await slotsCollection.updateOne(
                { _id: new ObjectId(id) },
                { $inc: { totalBookings: 1 } }
            );
            if (updatedSlot.modifiedCount > 0) {
                res.send({ message: 'Slot booked successfully' });
            } else {
                res.status(400).send({ message: 'Booking failed' });
            }
        });


        // Get all applied trainers
        app.get('/applied-trainers', async (req, res) => {
            try {
                const appliedTrainers = await appliedTrainersCollection.find({}).toArray();
                res.json(appliedTrainers);
            } catch (error) {
                console.error("Error fetching applied trainers:", error);
                res.status(500).json({ message: "Error fetching applied trainers" });
            }
        });


        // Confirm trainer and move to trainer list (add to users collection)
        app.post('/confirm-trainer/:id', async (req, res) => {
            const { id } = req.params;

            try {
                // Fetch the applied trainer from the applied-trainers collection
                const appliedTrainer = await appliedTrainersCollection.findOne({ _id: new ObjectId(id) });

                if (!appliedTrainer) {
                    return res.status(404).json({ message: 'Trainer not found in applied list' });
                }

                // Add the confirmed trainer to the 'users' collection
                const addTrainer = await usersCollection.insertOne({
                    ...appliedTrainer,
                    role: 'trainer', // Set the role to 'trainer'
                    status: 'confirmed' // Update status to 'confirmed'
                });

                if (!addTrainer.acknowledged) {
                    return res.status(500).json({ message: 'Failed to add trainer to users collection' });
                }

                // Remove from the applied trainers collection
                await appliedTrainersCollection.deleteOne({ _id: new ObjectId(id) });

                // Send a success response
                res.json({ message: 'Trainer confirmed and added to the users collection successfully!' });

            } catch (error) {
                console.error('Error confirming trainer:', error);
                res.status(500).json({ message: 'An error occurred while confirming the trainer', error });
            }
        });







        // Reject trainer (move applied trainer to 'rejected' list)
        app.delete('/reject-trainer/:id', async (req, res) => {
            const { id } = req.params;
            const { feedback } = req.body;

            if (!feedback) {
                return res.status(400).json({ message: 'Feedback is required for rejection' });
            }

            try {
                // Get the rejected trainer info from applied collection
                const rejectedTrainer = await appliedTrainersCollection.findOne({ _id: new ObjectId(id) });

                if (!rejectedTrainer) {
                    return res.status(404).json({ message: 'Trainer not found for rejection' });
                }

                // Save relevant data to rejectedTrainers
                const rejectedDoc = {
                    name: rejectedTrainer.name,
                    email: rejectedTrainer.email,
                    feedback,
                    status: "Rejected",
                    appliedId: id,
                    timestamp: new Date(),
                };

                await rejectedTrainersCollection.insertOne(rejectedDoc);

                // Remove from applied
                await appliedTrainersCollection.deleteOne({ _id: new ObjectId(id) });

                res.json({ message: 'Trainer rejected successfully' });
            } catch (error) {
                console.error('Error rejecting trainer:', error);
                res.status(500).json({ message: 'An error occurred while rejecting the trainer' });
            }
        });


        // Assuming you have an endpoint to create a new slot
        app.post('/applied-trainers', async (req, res) => {
            const application = req.body;
            application.status = 'pending';
            try {
                const result = await appliedTrainersCollection.insertOne(application);
                res.send(result);
            } catch (error) {
                res.status(500).json({ message: 'Failed to submit trainer application' });
            }
        });



        // 🧑‍🏫 Save Applied Trainer
        app.post('/applied-trainers', async (req, res) => {
            const application = req.body;
            application.status = 'pending';
            const result = await db.collection('appliedTrainers').insertOne(application);
            res.send(result);
        });

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




        // // Get all trainers
        app.get('/trainers', async (req, res) => {
            try {
                const trainers = await usersCollection.find({ role: 'trainer' }).toArray();
                res.json(trainers);  // Send the list of trainers as JSON
            } catch (error) {
                console.error("Error fetching trainers:", error);
                res.status(500).json({ error: "Failed to fetch trainers. Please try again later." });
            }
        });


        // Server-side route to get a trainer by ID (ObjectId format)
        app.get('/trainer/:id', async (req, res) => {
            const { id } = req.params;
            try {
                // Convert the string ID to ObjectId for querying
                const trainer = await usersCollection.findOne({ _id: new ObjectId(id) });

                if (!trainer) {
                    return res.status(404).send({ message: 'Trainer not found' });
                }

                res.send(trainer);  // Send the trainer data as a response
            } catch (error) {
                console.error('Error fetching trainer:', error);
                res.status(500).send({ message: 'Server error' });
            }
        });





        // Get slots for a specific trainer by email
        app.get('/slots/trainer/:email', async (req, res) => {
            const { email } = req.params;
            try {
                const slots = await slotsCollection.find({ trainerEmail: email }).toArray();
                if (slots.length === 0) {
                    return res.status(404).json({ message: "No slots found for this trainer." });
                }
                res.json(slots);  // Send the slots data
            } catch (error) {
                console.error("Error fetching slots:", error);
                res.status(500).json({ error: "Failed to fetch slots. Please try again later." });
            }
        });

        // GET: All slots for a specific trainer by email
        app.get('/slots', async (req, res) => {
            const email = req.query.email;
            const query = { email };
            const result = await slotsCollection.find(query).toArray();
            res.send(result);
        });

        // Route to fetch slots by the logged-in trainer's email
        app.get("/slots", async (req, res) => {
            const { email } = req.query; // Get trainer email from the query parameter

            // Check if the email is provided in the request
            if (!email) {
                return res.status(400).json({ error: "Email is required" });
            }

            try {
                // Find the slots that match the trainer's email
                const slots = await slotsCollection.find({ trainerEmail: email }).toArray();

                // If slots are found, return them
                if (slots.length > 0) {
                    return res.json(slots);
                } else {
                    return res.status(404).json({ message: "No slots found for this trainer." });
                }
            } catch (error) {
                console.error("Error fetching slots:", error);
                res.status(500).json({ error: "Failed to fetch slots. Please try again later." });
            }
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