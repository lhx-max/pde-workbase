'use client';
import dynamic from 'next/dynamic';
import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const App = dynamic(() => import('../src/App'), { ssr: false });

function RootGate() {
  const params = useSearchParams();
  const router = useRouter();
  const projectId = params.get('projectId');
  useEffect(() => { if (!projectId) router.replace('/session-apps'); }, [projectId, router]);
  if (!projectId) return null;
  return <App />;
}

export default function Page() {
  return <Suspense fallback={null}><RootGate /></Suspense>;
}
