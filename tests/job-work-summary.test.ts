import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { JobWorkSummary, jobWorkFromJob } from '@/components/jobs/job-work-summary';

const baseJob = {
  customerName: 'Pat Murphy',
  vehicleRegistration: '142-KY-9821',
  vehicleMake: 'Ford',
  vehicleModel: 'Focus',
  vehicleYear: 2016,
  vehicleColor: 'Blue',
  labourLines: [
    { description: 'Replace front brake pads and discs', hours: '2.5' },
    { description: '   ', hours: '' },
    { description: 'Brake fluid flush', hours: '' },
  ],
  parts: [
    { partName: 'Front brake pads', partNumber: 'BP-1182', qty: '1', unitPrice: '48.00' },
    { partName: '', partNumber: '', qty: '', unitPrice: '' },
  ],
  otherComments: '  Customer will collect after 5pm.  ',
};

describe('jobWorkFromJob', () => {
  it('builds the vehicle line and drops the blank lines the form leaves behind', () => {
    const work = jobWorkFromJob(baseJob);
    expect(work.vehicle).toBe('Ford Focus · 2016 · Blue · 142-KY-9821');
    expect(work.labour.map((l) => l.description)).toEqual(['Replace front brake pads and discs', 'Brake fluid flush']);
    expect(work.parts.map((p) => p.partName)).toEqual(['Front brake pads']);
    expect(work.comments).toBe('Customer will collect after 5pm.');
  });

  it('copes with a bare job', () => {
    const work = jobWorkFromJob({
      ...baseJob,
      vehicleMake: null,
      vehicleModel: null,
      vehicleYear: null,
      vehicleColor: null,
      labourLines: null,
      parts: null,
      otherComments: '   ',
    });
    expect(work.vehicle).toBe('142-KY-9821');
    expect(work.labour).toEqual([]);
    expect(work.parts).toEqual([]);
    expect(work.comments).toBeNull();
  });
});

describe('JobWorkSummary', () => {
  it('shows the work, the parts with part numbers and quantities, and the comments, but no prices', () => {
    const html = renderToStaticMarkup(createElement(JobWorkSummary, { work: jobWorkFromJob(baseJob) }));
    expect(html).toContain('Replace front brake pads and discs');
    expect(html).toContain('2.5 h');
    expect(html).toContain('Front brake pads');
    expect(html).toContain('BP-1182');
    expect(html).toContain('× 1');
    expect(html).toContain('Customer will collect after 5pm.');
    expect(html).not.toContain('48.00');
  });

  it('says so when nothing has been entered', () => {
    const html = renderToStaticMarkup(
      createElement(JobWorkSummary, {
        work: { vehicle: '', customer: 'Pat Murphy', labour: [], parts: [], comments: null },
      }),
    );
    expect(html).toContain('No work or parts entered on this job yet.');
  });
});
