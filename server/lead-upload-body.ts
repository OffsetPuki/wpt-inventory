import express from 'express';
import {timingSafeEqual} from 'crypto';

// Only authenticated website servers may use the larger upload envelope.
// The normal application-wide JSON limit remains unchanged.
const uploadJson=express.json({limit:29_000_000}),normalJson=express.json({limit:'1mb'});
export const leadUploadBody=[
 ((req,res,next)=>{
  const configured=process.env.LEAD_INTAKE_KEY;
  const supplied=req.headers['x-lead-key'];
  const authorized=!!configured&&typeof supplied==='string'&&Buffer.byteLength(supplied)===Buffer.byteLength(configured)&&timingSafeEqual(Buffer.from(supplied),Buffer.from(configured));
  // Normal route authentication still handles invalid-key alerts and responses.
  return (authorized?uploadJson:normalJson)(req,res,next);
 }) as express.RequestHandler,
];
