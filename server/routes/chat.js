import { Router } from 'express';
import { processMessage } from '../services/chat-engine.js';

const router = Router();

router.post('/', async (req, res) => {
  try {
    const result = await processMessage(req.body.message);
    res.json(result);
  } catch (err) {
    res.status(500).json({ answer: `Error: ${err.message}` });
  }
});

export default router;
