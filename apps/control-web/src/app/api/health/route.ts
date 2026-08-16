import { makeHealthResponse } from '@event-commerce/contracts';
import { NextResponse } from 'next/server';

export function GET(): NextResponse {
  return NextResponse.json(makeHealthResponse('control-web', new Date(), process.env.RELEASE_COMMIT));
}
