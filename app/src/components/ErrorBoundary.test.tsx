// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

afterEach(cleanup);

test('a render error shows a retry screen instead of a blank window, and Retry draws again', () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  let broken = true;
  function Table() {
    if (broken) throw new Error('boom');
    return <p>table</p>;
  }
  render(<ErrorBoundary><Table /></ErrorBoundary>);
  expect(screen.getByRole('alert').textContent).toContain('boom');
  broken = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(screen.getByText('table')).toBeTruthy();
  vi.restoreAllMocks();
});
