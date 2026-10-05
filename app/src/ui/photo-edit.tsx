import { lazy, Suspense } from 'react';
import { useIsAdmin } from './admin-access';
export { useIsAdmin, usePhotos } from './admin-access';
export type { PhotoSlot } from './photo-editor';
const Editor = lazy(() => import('./photo-editor').then(m => ({ default: m.PhotoEdit })));
export function PhotoEdit(props: import('react').ComponentProps<typeof Editor>) {
  const admin = useIsAdmin();
  return admin ? <Suspense fallback={null}><Editor {...props} /></Suspense> : null;
}
