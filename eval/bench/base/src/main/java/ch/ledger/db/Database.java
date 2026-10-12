package ch.ledger.db;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;

/** Opens connections to the SQLite file. Callers close them. */
public final class Database {
    private final String url;

    public Database(String path) {
        this.url = "jdbc:sqlite:" + path;
    }

    public Connection open() throws SQLException {
        return DriverManager.getConnection(url);
    }
}
