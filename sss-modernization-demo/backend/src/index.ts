import dotenv from 'dotenv';
import app from './app';

dotenv.config();

const PORT = process.env.PORT || 3001;

const server = app.listen(PORT, () => {
  console.log(`🚀 Backend server running on port ${PORT}`);
  console.log(`📍 http://localhost:${PORT}`);
  console.log(`🔐 CORS origin: ${process.env.CORS_ORIGIN || 'http://localhost:3000'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});
