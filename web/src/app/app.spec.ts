import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { DRAFT_ROOM_ENABLED } from './core/features';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the league wordmark and nav tabs', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.wordmark')?.textContent).toContain('Most Baller League');
    // Draft Room is the one hideable tab; the rest are always shown.
    expect(compiled.querySelectorAll('.nav .tab').length).toBe(DRAFT_ROOM_ENABLED ? 6 : 5);
    const labels = Array.from(compiled.querySelectorAll('.nav .tab')).map((t) => t.textContent);
    expect(labels.some((l) => l?.includes('Draft Room'))).toBe(DRAFT_ROOM_ENABLED);
  });
});
