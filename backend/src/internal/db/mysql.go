package db

import (
	"database/sql"
	"fmt"
	"log/slog"
	"os"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

var DB *sql.DB

func InitMySQL() {
	slog.Info("initializing MySQL")

	host := os.Getenv("DB_HOST")
	port := os.Getenv("DB_PORT")
	user := os.Getenv("DB_USER")
	name := os.Getenv("DB_NAME")
	pass := os.Getenv("DB_PASSWORD")

	if host == "" || port == "" || user == "" || name == "" {
		slog.Error("missing DB env vars",
			"DB_HOST", host != "", "DB_PORT", port != "",
			"DB_USER", user != "", "DB_NAME", name != "")
		panic("missing required database environment variables")
	}

	dsn := fmt.Sprintf(
		"%s:%s@tcp(%s:%s)/%s?parseTime=true&timeout=5s&readTimeout=10s&writeTimeout=10s",
		user, pass, host, port, name,
	)

	var err error
	DB, err = sql.Open("mysql", dsn)
	if err != nil {
		slog.Error("sql.Open failed", "error", err)
		panic(err)
	}

	// Production-grade connection pool
	DB.SetMaxOpenConns(25)
	DB.SetMaxIdleConns(10)
	DB.SetConnMaxLifetime(30 * time.Minute)
	DB.SetConnMaxIdleTime(10 * time.Minute)

	// Retry ping with exponential backoff (container may start before MySQL)
	for attempt := 1; attempt <= 5; attempt++ {
		if err = DB.Ping(); err == nil {
			slog.Info("MySQL connected")
			return
		}
		wait := time.Duration(attempt*attempt) * time.Second
		slog.Warn("MySQL ping failed, retrying",
			"attempt", attempt, "wait", wait, "error", err)
		time.Sleep(wait)
	}

	slog.Error("MySQL connection failed after retries", "error", err)
	panic(fmt.Sprintf("MySQL unreachable: %v", err))
}
