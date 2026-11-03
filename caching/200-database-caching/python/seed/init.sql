-- Seed data for the bookstore database.
-- Run this after starting PostgreSQL to populate the tables.
-- Safe to run multiple times (truncates existing data before inserting).

CREATE TABLE IF NOT EXISTS authors (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    bio TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS books (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    author_id INTEGER REFERENCES authors(id),
    genre TEXT,
    published_year INTEGER,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_books_author_id ON books(author_id);
CREATE INDEX IF NOT EXISTS idx_books_genre ON books(genre);

-- Clear existing data before re-seeding (makes the script idempotent)
TRUNCATE books, authors RESTART IDENTITY CASCADE;

-- Authors
INSERT INTO authors (name, bio) VALUES
('Ada Lovelace', 'Mathematician and writer, known for work on Charles Babbage''s Analytical Engine.'),
('Grace Hopper', 'Computer scientist and United States Navy rear admiral, pioneer of computer programming.'),
('Alan Turing', 'Mathematician and computer scientist, widely considered the father of theoretical computer science.'),
('Margaret Hamilton', 'Computer scientist and systems engineer, led the team that developed the Apollo flight software.'),
('Donald Knuth', 'Computer scientist and mathematician, author of The Art of Computer Programming.'),
('Barbara Liskov', 'Computer scientist known for the Liskov substitution principle and CLU programming language.'),
('Tim Berners-Lee', 'Computer scientist, inventor of the World Wide Web.'),
('Linus Torvalds', 'Software engineer, creator of Linux and Git.'),
('Guido van Rossum', 'Programmer, creator of the Python programming language.'),
('Vint Cerf', 'Internet pioneer, co-designer of TCP/IP protocols.'),
('Matt Dinniman', 'Author of the Dungeon Crawler Carl series, a LitRPG that blends dark humor with heart.'),
('J.R.R. Tolkien', 'Philologist and author who created Middle-earth, one of the most fully realized fictional worlds in literature.'),
('T.H. White', 'English author best known for The Once and Future King, a retelling of the Arthurian legend.'),
('John Green', 'Author and educator whose young adult novels explore grief, love, and the messiness of being a person.'),
('N.K. Jemisin', 'Speculative fiction author and three-time consecutive Hugo Award winner for the Broken Earth trilogy.'),
('Douglas Adams', 'Author and satirist, created The Hitchhiker''s Guide to the Galaxy.'),
('Octavia Butler', 'Science fiction author whose work explored race, power, and what it means to be human.'),
('Ursula K. Le Guin', 'Author of science fiction and fantasy, known for the Earthsea and Hainish cycles.'),
('Arthur C. Clarke', 'Science fiction author and futurist, co-wrote the screenplay for 2001: A Space Odyssey.'),
('Carl Sagan', 'Astronomer, author, and science communicator who made the cosmos accessible to everyone.'),
('Fred Rogers', 'Educator, minister, and television host who taught generations of children about kindness and self-worth.'),
('James Baldwin', 'Novelist, essayist, and activist whose writing confronted race, identity, and love in America.'),
('Brian Jacques', 'Author of the Redwall series, epic fantasy told through the lives of woodland creatures.'),
('Kurt Vonnegut', 'Novelist and satirist whose work blended science fiction, dark humor, and humanism.'),
('Toni Morrison', 'Novelist and Nobel laureate whose work explored Black American life with lyrical precision.'),
('Patrick Rothfuss', 'Fantasy author known for The Kingkiller Chronicle, a story about stories.'),
('Epictetus', 'Stoic philosopher, born into slavery, whose teachings on resilience and self-mastery survive through his students'' writings.'),
('Diogenes of Sinope', 'Cynic philosopher who lived in a barrel, challenged social conventions, and believed virtue was demonstrated through action, not words.'),
('Brian Fox', 'Programmer and free software advocate, original author of GNU Bash, the first paid programmer at the Free Software Foundation.'),
('George R.R. Martin', 'Author of A Song of Ice and Fire, a fantasy series that treats consequences as non-negotiable.'),
('Randall Munroe', 'Former NASA roboticist turned cartoonist and author. Created xkcd and wrote books that answer absurd questions with real physics.'),
('Philipp Dettmer', 'Founder and head writer of Kurzgesagt, the science YouTube channel that makes complex topics accessible through animation and clarity.'),
('Micah Lee', 'Security engineer, journalist, and author. Built OnionShare, worked at The Intercept, and wrote the book on analyzing leaked datasets.'),
('Roald Dahl', 'British author whose children''s books are strange, dark, funny, and never talk down to the reader.');

-- Books: Computing
INSERT INTO books (title, author_id, genre, published_year, description) VALUES
('Notes on the Analytical Engine', 1, 'computing', 1843, 'The first published algorithm intended for implementation on a computer.'),
('A New Method of Compiler Design', 2, 'computing', 1952, 'Foundational work on automated programming and compiler theory.'),
('Computing Machinery and Intelligence', 3, 'computing', 1950, 'The paper that introduced the Turing test as a measure of machine intelligence.'),
('On Computable Numbers', 3, 'computing', 1936, 'Foundational paper introducing the concept of a universal computing machine.'),
('Apollo Flight Software Design', 4, 'engineering', 1969, 'Documentation of the software that guided Apollo missions to the moon.'),
('The Art of Computer Programming Vol 1', 5, 'computing', 1968, 'Comprehensive monograph covering fundamental algorithms and data structures.'),
('The Art of Computer Programming Vol 3', 5, 'computing', 1973, 'Sorting and searching algorithms with rigorous analysis.'),
('Abstraction and Specification in Program Development', 6, 'computing', 1986, 'Textbook on software abstraction and modular design.'),
('Information Management: A Proposal', 7, 'computing', 1989, 'The original proposal for the World Wide Web.'),
('Linux: A Portable Operating System', 8, 'computing', 1997, 'Technical overview of the Linux kernel architecture.'),
('Python Reference Manual', 9, 'computing', 1991, 'The original reference documentation for the Python language.'),
('Internetworking with TCP/IP', 10, 'networking', 1978, 'Technical specification of the TCP/IP protocol suite.');

-- Books: Fantasy
INSERT INTO books (title, author_id, genre, published_year, description) VALUES
('Dungeon Crawler Carl', 11, 'fantasy', 2020, 'A man and his cat enter a deadly alien dungeon game after Earth is destroyed. It''s funnier than it has any right to be.'),
('Carl''s Doomsday Scenario', 11, 'fantasy', 2021, 'The dungeon gets deeper, the stakes get higher, and Carl gets angrier.'),
('The Fellowship of the Ring', 12, 'fantasy', 1954, 'Nine companions set out to destroy the One Ring and save Middle-earth.'),
('The Two Towers', 12, 'fantasy', 1954, 'The fellowship is broken. The war for Middle-earth begins in earnest.'),
('The Return of the King', 12, 'fantasy', 1955, 'The final confrontation with Sauron and the crowning of the true king.'),
('The Once and Future King', 13, 'fantasy', 1958, 'A retelling of King Arthur''s life, from boy to broken king. Equal parts whimsy and tragedy.'),
('The Sword in the Stone', 13, 'fantasy', 1938, 'Young Wart''s education under Merlyn, who teaches by transformation.'),
('The Fifth Season', 15, 'fantasy', 2015, 'A world that ends regularly, told in second person. Won the Hugo and deserved it.'),
('The Obelisk Gate', 15, 'fantasy', 2016, 'The Stillness continues to break. Essun searches for her daughter.'),
('The Stone Sky', 15, 'fantasy', 2017, 'The conclusion of the Broken Earth trilogy. The world decides what it wants to be.'),
('The Name of the Wind', 26, 'fantasy', 2007, 'Kvothe tells the story of his life to a chronicler. A story about the nature of stories.'),
('The Wise Man''s Fear', 26, 'fantasy', 2011, 'Kvothe continues his tale. The University, the Fae, and the Adem.');

-- Books: Science Fiction
INSERT INTO books (title, author_id, genre, published_year, description) VALUES
('The Hitchhiker''s Guide to the Galaxy', 16, 'science fiction', 1979, 'Earth is demolished for a hyperspace bypass. Arthur Dent handles it poorly.'),
('The Restaurant at the End of the Universe', 16, 'science fiction', 1980, 'The gang goes to dinner at the literal end of time. The universe does not improve.'),
('Kindred', 17, 'science fiction', 1979, 'A Black woman in 1976 is pulled back to antebellum Maryland. No technology explains why.'),
('Parable of the Sower', 17, 'science fiction', 1993, 'A young woman builds a community and a religion in a collapsing America. Written in 1993, reads like tomorrow.'),
('The Left Hand of Darkness', 18, 'science fiction', 1969, 'An envoy visits a world where people have no fixed gender. What changes? Everything.'),
('The Dispossessed', 18, 'science fiction', 1974, 'A physicist travels between two worlds with opposing political systems. Neither is paradise.'),
('2001: A Space Odyssey', 19, 'science fiction', 1968, 'Humanity finds a monolith on the moon and sends a mission to Jupiter. HAL has other plans.'),
('Rendezvous with Rama', 19, 'science fiction', 1973, 'A massive alien cylinder enters the solar system. Humanity explores it. It does not explain itself.'),
('Childhood''s End', 19, 'science fiction', 1953, 'Aliens arrive and bring utopia. The cost is everything humanity thought it was.'),
('Slaughterhouse-Five', 24, 'science fiction', 1969, 'Billy Pilgrim comes "unstuck in time." A war novel that refuses to be a war novel.'),
('Cat''s Cradle', 24, 'science fiction', 1963, 'A substance called ice-nine and a religion called Bokononism. The world ends. So it goes.');

-- Books: Non-fiction
INSERT INTO books (title, author_id, genre, published_year, description) VALUES
('Cosmos', 20, 'non-fiction', 1980, 'A journey through the universe that makes you feel small and significant at the same time.'),
('The Demon-Haunted World', 20, 'non-fiction', 1995, 'A case for science and skepticism as tools against darkness. More relevant every year.'),
('You Are Special', 21, 'non-fiction', 1994, 'A children''s book about inherent worth. Somehow not condescending to adults who read it.'),
('The World According to Mister Rogers', 21, 'non-fiction', 2003, 'Collected wisdom from someone who meant every word he ever said on television.'),
('The Fire Next Time', 22, 'non-fiction', 1963, 'Two essays on race in America that read like prophecy. Baldwin at his most urgent.'),
('Notes of a Native Son', 22, 'non-fiction', 1955, 'Essays on being Black in America and in Paris. Precise, furious, and beautiful.');

-- Books: Fiction / Literary
INSERT INTO books (title, author_id, genre, published_year, description) VALUES
('The Fault in Our Stars', 14, 'fiction', 2012, 'Two teenagers with cancer fall in love. It earns every emotion it asks for.'),
('Looking for Alaska', 14, 'fiction', 2005, 'A boy goes to boarding school looking for the Great Perhaps. Finds something harder.'),
('Giovanni''s Room', 22, 'fiction', 1956, 'An American in Paris confronts desire, shame, and the cost of denial.'),
('Song of Solomon', 25, 'fiction', 1977, 'A man traces his family''s history and learns to fly. Literally and not.'),
('Beloved', 25, 'fiction', 1987, 'A ghost story about slavery, memory, and what it costs to survive.');

-- Books: Children's / Young Adult
INSERT INTO books (title, author_id, genre, published_year, description) VALUES
('Redwall', 23, 'childrens', 1986, 'Matthias the mouse defends Redwall Abbey. The feasts are described in more detail than the battles.'),
('Mossflower', 23, 'childrens', 1988, 'The founding of Redwall, told through Martin the Warrior. The good guys win. It costs them.'),
('Martin the Warrior', 23, 'childrens', 1993, 'The origin story. Martin earns his sword and loses nearly everything else.');

-- Books: Philosophy
INSERT INTO books (title, author_id, genre, published_year, description) VALUES
('Discourses', 27, 'philosophy', 108, 'Lectures on Stoic philosophy recorded by Arrian. How to live when you control nothing but your own mind.'),
('Enchiridion', 27, 'philosophy', 125, 'The handbook. A distillation of Stoic practice into actionable principles.'),
('Sayings of Diogenes', 28, 'philosophy', -350, 'Reconstructed anecdotes and quotes. The man who told Alexander the Great to move out of his sunlight.'),
('Republic (as challenged by Diogenes)', 28, 'philosophy', -340, 'A lost work, known only through references. Argued against social conventions and for living according to nature.'),
('GNU Bash', 29, 'computing', 1989, 'A free replacement for the Bourne shell. The most widely used shell on the planet, written without access to the original source code.'),
('GNU Readline Library', 29, 'computing', 1989, 'An input library that gives any program line-editing and history capabilities. Used by thousands of programs that never credit it.'),
('GNU Info', 29, 'computing', 1986, 'A documentation system for the GNU Project. How free software taught itself to explain itself.'),
('A Game of Thrones', 30, 'fantasy', 1996, 'The noble houses of Westeros play politics. Nobody is safe. The first book in a series that redefined what fantasy readers would tolerate.'),
('A Storm of Swords', 30, 'fantasy', 2000, 'The war reaches its peak. The Red Wedding happens. Readers learn that GRRM does not negotiate with expectations.'),
('What If?', 31, 'non-fiction', 2014, 'Serious scientific answers to absurd hypothetical questions. What if you threw a baseball at the speed of light?'),
('Thing Explainer', 31, 'non-fiction', 2015, 'Complex things explained using only the thousand most common words. A rocket becomes a "thing that goes up real high."'),
('What If? 2', 31, 'non-fiction', 2022, 'More absurd questions, more real physics. What if you tried to build a lava moat?'),
('Immune', 32, 'non-fiction', 2021, 'A gorgeously illustrated tour of the human immune system. Makes cellular biology feel like a story worth following.'),
('Hacks, Leaks, and Revelations', 33, 'computing', 2023, 'A hands-on guide to analyzing hacked and leaked datasets. No prior experience required. Published by No Starch Press.'),
('Charlie and the Chocolate Factory', 34, 'childrens', 1964, 'A poor boy wins a tour of a mysterious factory. The other children are awful. Justice is served creatively.'),
('Matilda', 34, 'childrens', 1988, 'A brilliant girl with terrible parents discovers she has telekinetic powers. Uses them on the right people.'),
('James and the Giant Peach', 34, 'childrens', 1961, 'A boy escapes his cruel aunts inside a magically enlarged peach. It rolls into the ocean. Things get stranger from there.'),
('The BFG', 34, 'childrens', 1982, 'A big friendly giant catches dreams in jars and blows them into children''s bedrooms. The other giants eat children. Contrast is the point.');
