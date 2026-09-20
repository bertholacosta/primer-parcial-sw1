package com.example.biblioteca.biblioteca.repository;

import com.example.biblioteca.biblioteca.entity.AutorEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface AutorRepository extends JpaRepository<AutorEntity, Long> {
}
