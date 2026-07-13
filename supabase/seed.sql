-- ============================================================
-- Detective Conan PH — Seed Data
-- Run this in Supabase SQL Editor AFTER the schema is set up
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- ARCS
-- ─────────────────────────────────────────────────────────────
INSERT INTO arcs (slug, title, description, start_episode, end_episode) VALUES
  ('introduction', 'Introduction Arc', 'Shinichi Kudo is transformed into Conan Edogawa and begins his double life.', 1, 5),
  ('black-org-intro', 'Black Organization Introduction', 'The first encounters with members of the Black Organization.', 6, 13),
  ('early-cases', 'Early Cases', 'Conan solves various cases while searching for the Black Organization.', 14, 50),
  ('desperate-revival', 'Desperate Revival', 'A major case arc involving multiple murders and organization clues.', 188, 193)
ON CONFLICT (slug) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- CONTENT ENTRIES — Episodes 1-50 + Movies + Specials
-- ─────────────────────────────────────────────────────────────

-- Episodes 1-50
INSERT INTO content_entries (slug, title, type, episode_number, air_date, canon_order, synopsis, runtime_minutes) VALUES
  ('ep-001', 'Roller Coaster Murder Case', 'episode', 1, '1996-01-08', 1, 'High school detective Shinichi Kudo witnesses a murder on a roller coaster and is poisoned by the Black Organization, shrinking into a child.', 25),
  ('ep-002', 'Company President''s Daughter Kidnapping Case', 'episode', 2, '1996-01-15', 2, 'Conan solves a kidnapping case involving a company president''s daughter, showcasing his deductive abilities in his new form.', 25),
  ('ep-003', 'An Idol''s Locked Room Murder Case', 'episode', 3, '1996-01-22', 3, 'A famous idol is found murdered in a locked room. Conan must figure out how the killer escaped.', 25),
  ('ep-004', 'Coded Map of the City Case', 'episode', 4, '1996-01-29', 4, 'The Detective Boys follow a coded map that leads them into danger across the city.', 25),
  ('ep-005', 'The Shinkansen''s Big Mystery', 'episode', 5, '1996-02-05', 5, 'On a bullet train ride, Conan encounters a bombing threat and must find the bomb before time runs out.', 25),
  ('ep-006', 'Valentine''s Murder Case', 'episode', 6, '1996-02-12', 6, 'A Valentine''s Day party turns deadly when one of the guests is found murdered.', 25),
  ('ep-007', 'Once-A-Month Present Threat Case', 'episode', 7, '1996-02-19', 7, 'Ran receives threatening gifts every month from an anonymous sender. Conan investigates the stalker.', 25),
  ('ep-008', 'Art Museum Owner Murder Case', 'episode', 8, '1996-02-26', 8, 'The owner of an art museum is murdered and a valuable painting is stolen.', 25),
  ('ep-009', 'Tenkaichi Fire Festival Murder Case', 'episode', 9, '1996-03-04', 9, 'During a fire festival, a man is found dead. Conan suspects it was not an accident.', 25),
  ('ep-010', 'Pro Soccer Player Threatening Case', 'episode', 10, '1996-03-11', 10, 'A professional soccer player is being threatened, and Conan must find the culprit before the big match.', 25),
  ('ep-011', 'Moonlight Sonata Murder Case', 'episode', 11, '1996-03-18', 11, 'On a remote island, Conan investigates murders connected to Beethoven''s Moonlight Sonata. One of the most iconic early cases.', 25),
  ('ep-012', 'Ayumi-chan Kidnapping Case', 'episode', 12, '1996-03-25', 12, 'Ayumi is kidnapped, and the Detective Boys must work with Conan to rescue her.', 25),
  ('ep-013', 'The Strange Person Hunt Murder Case', 'episode', 13, '1996-04-08', 13, 'A peculiar treasure hunt organized by a mysterious person turns into a murder investigation.', 25),
  ('ep-014', 'The Mysterious Shooting Message Case', 'episode', 14, '1996-04-15', 14, 'Mysterious shooting incidents leave coded messages. Conan deciphers them to find the perpetrator.', 25),
  ('ep-015', 'Missing Corpse Murder Case', 'episode', 15, '1996-04-22', 15, 'A body disappears from a crime scene. Conan must figure out where it went and who moved it.', 25),
  ('ep-016', 'Antique Collector Murder Case', 'episode', 16, '1996-04-29', 16, 'An antique collector is murdered among his prized possessions.', 25),
  ('ep-017', 'Department Store Hijacking Case', 'episode', 17, '1996-05-06', 17, 'A department store is taken over by armed robbers. Conan must save the hostages.', 25),
  ('ep-018', 'June Bride Murder Case', 'episode', 18, '1996-05-13', 18, 'A wedding ceremony is disrupted by a murder connected to the bride''s past.', 25),
  ('ep-019', 'An Elevator Murder Case', 'episode', 19, '1996-05-20', 19, 'A murder occurs in a stopped elevator, and Conan is trapped with the suspects.', 25),
  ('ep-020', 'A Haunted Mansion Murder Case', 'episode', 20, '1996-05-27', 20, 'The Detective Boys explore a supposedly haunted mansion and uncover a real crime.', 25),
  ('ep-021', 'On Location, TV Drama Murder Case', 'episode', 21, '1996-06-03', 21, 'During a TV drama filming, an actor is killed on set.', 25),
  ('ep-022', 'Luxury Liner Serial Murder Case (Part 1)', 'episode', 22, '1996-06-10', 22, 'On a luxury cruise ship, passengers begin to die one by one.', 25),
  ('ep-023', 'Luxury Liner Serial Murder Case (Part 2)', 'episode', 23, '1996-06-17', 23, 'Conan races to identify the serial killer on the ship before more lives are lost.', 25),
  ('ep-024', 'A Female College Professor Murder Case', 'episode', 24, '1996-06-24', 24, 'A university professor is murdered in her office, and the clues point to her students.', 25),
  ('ep-025', 'Fake Kidnapping and Hostage Case', 'episode', 25, '1996-07-01', 25, 'What appears to be a kidnapping turns out to be a staged crime hiding a darker motive.', 25),
  ('ep-026', 'Pet Dog John Murder Case', 'episode', 26, '1996-07-08', 26, 'A missing pet dog case leads Conan to uncover a murder.', 25),
  ('ep-027', 'Kogoro''s Class Reunion Murder Case (Part 1)', 'episode', 27, '1996-07-15', 27, 'At Kogoro''s school reunion, an old classmate is found dead.', 25),
  ('ep-028', 'Kogoro''s Class Reunion Murder Case (Part 2)', 'episode', 28, '1996-07-22', 28, 'Conan pieces together the clues from Kogoro''s past to solve the reunion murder.', 25),
  ('ep-029', 'Computer Murder Case', 'episode', 29, '1996-07-29', 29, 'A murder linked to a computer program leads to a tech-savvy killer.', 25),
  ('ep-030', 'Alibi Testimony Murder Case', 'episode', 30, '1996-08-05', 30, 'A suspect has a perfect alibi, but Conan finds the flaw in the testimony.', 25),
  ('ep-031', 'TV Station Murder Case', 'episode', 31, '1996-08-12', 31, 'A murder at a TV station during a live broadcast.', 25),
  ('ep-032', 'Coffee Shop Murder Case', 'episode', 32, '1996-08-19', 32, 'A regular at a coffee shop is found dead, and the barista is the prime suspect.', 25),
  ('ep-033', 'Detective Agency Murder Case', 'episode', 33, '1996-08-26', 33, 'A client is murdered at the Mouri Detective Agency itself.', 25),
  ('ep-034', 'Mountain Villa Bandaged Man Murder Case (Part 1)', 'episode', 34, '1996-09-02', 34, 'At a mountain villa, a bandaged man terrorizes the guests.', 25),
  ('ep-035', 'Mountain Villa Bandaged Man Murder Case (Part 2)', 'episode', 35, '1996-09-09', 35, 'Conan unmasks the bandaged man and reveals the shocking truth behind the murders.', 25),
  ('ep-036', 'Monday Night 7:30 PM Murder Case', 'episode', 36, '1996-09-16', 36, 'A murder occurs at exactly 7:30 PM every Monday, following a mysterious pattern.', 25),
  ('ep-037', 'Cactus Flower Murder Case', 'episode', 37, '1996-10-21', 37, 'A rare cactus flower that blooms once a year becomes the centerpiece of a murder mystery.', 25),
  ('ep-038', 'Akaoni Village Fire Festival Murder Case', 'episode', 38, '1996-10-28', 38, 'During a village fire festival, ancient grudges lead to modern-day murder.', 25),
  ('ep-039', 'The Wealthy Daughter Murder Case (Part 1)', 'episode', 39, '1996-11-04', 39, 'A wealthy heiress is targeted in a complex murder plot.', 25),
  ('ep-040', 'The Wealthy Daughter Murder Case (Part 2)', 'episode', 40, '1996-11-11', 40, 'Conan uncovers the conspiracy behind the wealthy family murders.', 25),
  ('ep-041', 'The Victory Flag Fluttering in Integrity Case', 'episode', 41, '1996-11-18', 41, 'A sports competition leads to theft and deception.', 25),
  ('ep-042', 'Karaoke Box Murder Case', 'episode', 42, '1996-11-25', 42, 'A murder occurs in a karaoke box, and the soundproof walls hide the truth.', 25),
  ('ep-043', 'Edogawa Conan Kidnapping Case', 'episode', 43, '1996-12-02', 43, 'Conan himself is kidnapped! Can the Detective Boys and Kogoro rescue him?', 25),
  ('ep-044', 'Hotta Yusaku''s Case (Part 1)', 'episode', 44, '1996-12-09', 44, 'A case connected to a famous author leads Conan on a literary mystery.', 25),
  ('ep-045', 'Hotta Yusaku''s Case (Part 2)', 'episode', 45, '1996-12-16', 45, 'The literary mystery deepens with revelations about hidden manuscripts.', 25),
  ('ep-046', 'Snowstorm Mountain Villa Murder Case', 'episode', 46, '1996-12-23', 46, 'Trapped in a snowstorm at a mountain villa, the group faces a deadly killer.', 25),
  ('ep-047', 'Sports Club Murder Case', 'episode', 47, '1997-01-06', 47, 'A murder at an exclusive sports club reveals hidden rivalries.', 25),
  ('ep-048', 'Diplomat Murder Case (Part 1)', 'episode', 48, '1997-01-13', 48, 'The murder of a diplomat leads to international intrigue. Heiji Hattori makes his first appearance.', 25),
  ('ep-049', 'Diplomat Murder Case (Part 2)', 'episode', 49, '1997-01-20', 49, 'Conan and Heiji work together for the first time to solve the diplomat case.', 25),
  ('ep-050', 'Library Murder Case', 'episode', 50, '1997-01-27', 50, 'A librarian is found murdered among the bookshelves with a cryptic dying message.', 25)
ON CONFLICT (slug) DO NOTHING;

-- Movies
INSERT INTO content_entries (slug, title, type, movie_number, air_date, canon_order, synopsis, runtime_minutes) VALUES
  ('mov-01', 'The Time-Bombed Skyscraper', 'movie', 1, '1997-04-19', 1001, 'Conan must defuse bombs planted throughout a series of buildings by a vengeful architect.', 95),
  ('mov-02', 'The Fourteenth Target', 'movie', 2, '1998-04-18', 1002, 'Someone is targeting people connected to Kogoro, counting down from 14. Conan races to find the pattern.', 99),
  ('mov-03', 'The Last Wizard of the Century', 'movie', 3, '1999-04-17', 1003, 'Kaito Kid returns to steal a Fabergé egg, but a sniper from the shadows complicates everything.', 100),
  ('mov-04', 'Captured in Her Eyes', 'movie', 4, '2000-04-22', 1004, 'Ran loses her memory after witnessing a murder, and Conan must protect her from the killer.', 107),
  ('mov-05', 'Countdown to Heaven', 'movie', 5, '2001-04-21', 1005, 'A series of bombings targets newly built twin towers, with the Black Organization lurking nearby.', 100)
ON CONFLICT (slug) DO NOTHING;

-- Specials / OVAs
INSERT INTO content_entries (slug, title, type, air_date, canon_order, synopsis, runtime_minutes) VALUES
  ('sp-01', 'Conan vs. Kid vs. Yaiba', 'special', '2000-01-03', 2001, 'A crossover special featuring Conan, Kaito Kid, and Yaiba in a comedic battle of wits.', 90),
  ('ova-01', 'Conan vs. Kid: Jet Black Sniper', 'ova', '2003-04-11', 2002, 'Conan faces off against Kaito Kid in a thrilling OVA adventure involving a mysterious sniper.', 30)
ON CONFLICT (slug) DO NOTHING;
