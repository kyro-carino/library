<?php
$discoverView = $discoverView ?? 'dashboard';
$discoverViewAttr = htmlspecialchars($discoverView, ENT_QUOTES);
?>
          <section class="site-section library-photo-section" aria-label="The FEU Roosevelt Library building">
            <div class="library-photo-frame">
              <div class="library-photo-media">
                <img class="library-photo-img" src="img/library-home.svg" alt="A warm, light-filled reading room inside the FEU Roosevelt Library" loading="lazy" width="1600" height="900">
              </div>
              <div class="library-photo-caption">
                <span class="library-photo-eyebrow">Our home</span>
                <span class="library-photo-line">FEU Roosevelt Library</span>
                <p class="library-photo-body">A quiet, light-filled space built for reading, research, and everything in between.</p>
                <button class="btn library-photo-cta" type="button" data-anchor="about">
                  Learn more
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
                </button>
              </div>
            </div>
          </section>

          <section class="site-section services-section" id="services" aria-labelledby="services-heading">
            <div class="site-section-head">
              <div>
                <h2 class="site-section-heading" id="services-heading">Library services</h2>
                <p class="site-section-sub">Everything the collection offers, beyond the shelves.</p>
              </div>
            </div>
            <div class="services-grid">
              <div class="service-card">
                <div class="service-card-photo"><img src="img/service-borrowing.svg" alt="" width="800" height="500" loading="lazy"></div>
                <div class="service-card-body">
                  <div class="service-index">01</div>
                  <h3>Borrowing</h3>
                  <p id="svc-borrowing-text">Take home titles from the collection, with straightforward loan periods for students and faculty.</p>
                </div>
              </div>
              <div class="service-card">
                <div class="service-card-photo"><img src="img/service-reservations.svg" alt="" width="800" height="500" loading="lazy"></div>
                <div class="service-card-body">
                  <div class="service-index">02</div>
                  <h3>Reservations</h3>
                  <p>Hold a title that's out on loan and we'll set it aside the moment it's returned.</p>
                </div>
              </div>
              <div class="service-card">
                <div class="service-card-photo"><img src="img/service-visit.svg" alt="" width="800" height="500" loading="lazy"></div>
                <div class="service-card-body">
                  <div class="service-index">03</div>
                  <h3>Visit us</h3>
                  <p id="svc-contact-text">Visit the front desk for help finding a title.</p>
                </div>
              </div>
              <div class="service-card">
                <div class="service-card-photo"><img src="img/service-research.svg" alt="" width="800" height="500" loading="lazy"></div>
                <div class="service-card-body">
                  <div class="service-index">04</div>
                  <h3>Research assistance</h3>
                  <p>Sit down with a librarian to shape a search, a citation list, or a reading path.</p>
                </div>
              </div>
              <div class="service-card">
                <div class="service-card-photo"><img src="img/service-digital.svg" alt="" width="800" height="500" loading="lazy"></div>
                <div class="service-card-body">
                  <div class="service-index">05</div>
                  <h3>Digital resources</h3>
                  <p>Journals, archives, and databases available on and off campus with your student account.</p>
                </div>
              </div>
            </div>
          </section>

          <section class="editorial-statement" id="about" aria-label="Library statement">
            <p>Read widely.<br>Think deeply.</p>
            <span class="editorial-rule"></span>
            <p class="editorial-sub">A good library changes what you notice.</p>
          </section>

          <footer class="site-footer">
            <div class="site-footer-top">
              <div class="site-footer-brand">
                <span class="mark">FEU Roosevelt</span>
                <span class="tag">Library</span>
              </div>
              <div class="site-footer-col">
                <div class="site-footer-label">Navigate</div>
                <button type="button" data-view="<?= $discoverViewAttr ?>">Discover</button>
                <button type="button" data-view="books">Collection</button>
                <button type="button" data-anchor="services">Services</button>
                <button type="button" data-anchor="about">About</button>
              </div>
              <div class="site-footer-col">
                <div class="site-footer-label">Visit</div>
                <span id="footer-address"></span>
                <span id="footer-phone"></span>
                <span id="footer-email"></span>
              </div>
            </div>
            <div class="site-footer-bottom">
              <span>&copy; <span id="footer-year">2026</span> FEU Roosevelt Library. All rights reserved. Made by Mikhail D. Pabular - Kyro Carino - John Patrick De Luna - Dirk Martin Sotto</span>
            </div>
          </footer>
