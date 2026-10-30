import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Política de Tratamiento de Datos Personales · Mental Pieces',
};

export default function DataPolicyLayout({ children }: { children: ReactNode }) {
  return children;
}
