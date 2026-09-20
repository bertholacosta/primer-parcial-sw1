package com.example.biblioteca.biblioteca.repository;

import com.example.biblioteca.biblioteca.entity.LibroEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface LibroRepository extends JpaRepository<LibroEntity, Long> {
}
