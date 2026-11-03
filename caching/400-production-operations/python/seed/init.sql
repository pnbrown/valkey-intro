-- Seed data for the bookstore database.
-- Identical to the 300-level seed. Run after starting PostgreSQL.
-- Safe to run multiple times (truncates before inserting).

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
('Vint Cerf', 'Internet pioneer, co-designer of TCP/IP protocols.');

-- Books
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
('Internetworking with TCP/IP', 10, 'networking', 1978, 'Technical specification of the TCP/IP protocol suite.'),
('The Hitchhiker''s Guide to the Galaxy', 3, 'science fiction', 1979, 'Earth is demolished for a hyperspace bypass. Arthur Dent handles it poorly.'),
('2001: A Space Odyssey', 5, 'science fiction', 1968, 'Humanity finds a monolith on the moon and sends a mission to Jupiter. HAL has other plans.'),
('Cosmos', 9, 'non-fiction', 1980, 'A journey through the universe that makes you feel small and significant at the same time.');
